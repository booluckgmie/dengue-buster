"""Models and honest evaluation.

Explainable model : negative-binomial GLM (log link, population offset) -> incidence-rate ratios.
Predictive model  : gradient-boosted trees with Poisson loss.
Evaluation        : rolling-origin backtest (train strictly on the past, test on the next year), with factor
                    groups added one at a time so each group's out-of-sample contribution is visible.
"""
import warnings

import numpy as np
import pandas as pd
import statsmodels.api as sm
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_poisson_deviance


class NB:
    """NB2 GLM with dispersion estimated by moments from a Poisson first pass."""

    def fit(self, X: pd.DataFrame, y, offset=None):
        self.cols = list(X.columns)
        Xc = sm.add_constant(X.astype(float), has_constant="add")
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            p = sm.GLM(y, Xc, family=sm.families.Poisson(), offset=offset).fit()
            mu = p.mu
            self.alpha = float(np.clip(np.mean(((y - mu) ** 2 - mu) / np.maximum(mu, 1e-9) ** 2), 1e-3, 5))
            self.res = sm.GLM(y, Xc, family=sm.families.NegativeBinomial(alpha=self.alpha), offset=offset).fit()
        return self

    def predict(self, X, offset=None):
        Xc = sm.add_constant(X[self.cols].astype(float), has_constant="add")
        return np.asarray(self.res.predict(Xc, offset=offset))

    def irr(self) -> pd.DataFrame:
        ci = self.res.conf_int()
        out = pd.DataFrame({"term": self.res.params.index, "irr": np.exp(self.res.params.values), "lo": np.exp(ci[0].values),
                            "hi": np.exp(ci[1].values), "p": self.res.pvalues.values})
        return out[out.term != "const"].reset_index(drop=True)


def _gbm():
    return HistGradientBoostingRegressor(loss="poisson", max_iter=250, learning_rate=0.05, max_depth=4,
                                         min_samples_leaf=15, l2_regularization=1.0, random_state=0)


def _metrics(y, pred, naive):
    pred = np.maximum(pred, 1e-6)
    mae, mae0 = float(np.mean(np.abs(y - pred))), float(np.mean(np.abs(y - naive)))
    return {"mae": mae, "deviance": float(mean_poisson_deviance(y, pred)), "skill": 1 - mae / mae0 if mae0 else None,
            "bias": float(np.mean(pred - y)), "n": int(len(y))}


SPECS = [("Seasonality only", ["season"]),
         ("+ Weather lags", ["season", "weather"]),
         ("+ ENSO / IOD", ["season", "weather", "climate"]),
         ("Recent cases", ["season", "cases"]),
         ("Cases + neighbours", ["season", "cases", "neighbour"]),
         ("Cases + weather", ["season", "cases", "weather"]),
         ("All factors", ["season", "cases", "weather", "climate", "neighbour"])]


def backtest_region_month(panel: pd.DataFrame, groups: dict, test_years) -> tuple:
    """1-month-ahead rolling-origin backtest. Returns (scores by spec, out-of-sample predictions)."""
    fe = pd.get_dummies(panel.region, prefix="r", drop_first=True, dtype=float)
    off = np.log(panel.population.values)
    y = panel.cases.values.astype(float)
    naive = np.expm1(panel.lc_l1.values) * panel.population.values / 1e5          # persistence: last month's incidence
    preds, scores = {}, []
    specs = [(n, g, "NB-GLM") for n, g in SPECS if all(k in groups for k in g)] + [("All factors", [k for k in groups], "GBM")]
    for name, gs, kind in specs:
        cols = sum((groups[g] for g in gs), [])
        X = pd.concat([panel[cols], fe], axis=1)
        p = np.full(len(panel), np.nan)
        for yr in test_years:
            tr, te = (panel.year < yr).values, (panel.year == yr).values
            if te.sum() == 0:
                continue
            if kind == "NB-GLM":
                p[te] = NB().fit(X[tr], y[tr], off[tr]).predict(X[te], off[te])
            else:
                Xg = X.assign(logpop=off)
                p[te] = _gbm().fit(Xg[tr], y[tr]).predict(Xg[te])
        ok = ~np.isnan(p)
        m = _metrics(y[ok], p[ok], naive[ok])
        # operational metric: how many of the true top-3 incidence regions each month did the model flag?
        t = panel[ok].assign(pred=p[ok] / panel.population.values[ok], act=panel.inc.values[ok])
        hits = [len(set(g.nlargest(3, "pred").region) & set(g.nlargest(3, "act").region)) / 3 for _, g in t.groupby("month") if len(g) >= 6]
        m.update({"spec": name, "model": kind, "groups": gs, "top3": float(np.mean(hits))})
        scores.append(m)
        preds[f"{name}|{kind}"] = p
    return pd.DataFrame(scores), preds


def backtest_national_week(panel: pd.DataFrame, group_fn, horizons, test_years) -> tuple:
    rows, series = [], {}
    y = panel.cases.values.astype(float)
    yr = panel.week.dt.year.values
    for h in horizons:
        g = group_fn(h)
        naive = np.expm1(panel[f"lc_l{h}"].values)
        for name, gs in [("Seasonality only", ["season"]), ("+ Weather lags", ["season", "weather"]), ("Recent cases", ["season", "cases"]),
                         ("Cases + weather", ["season", "cases", "weather"]), ("All factors", ["season", "cases", "weather", "climate"])]:
            cols = sum((g[k] for k in gs), [])
            ok_rows = panel[cols].notna().all(axis=1).values
            p = np.full(len(panel), np.nan)
            for ty in test_years:
                tr, te = ok_rows & (yr < ty), ok_rows & (yr == ty)
                if te.sum():
                    p[te] = NB().fit(panel.loc[tr, cols], y[tr]).predict(panel.loc[te, cols])
            ok = ~np.isnan(p)
            m = _metrics(y[ok], p[ok], naive[ok])
            m.update({"spec": name, "model": "NB-GLM", "horizon": h})
            rows.append(m)
            series[(name, h)] = p
    return pd.DataFrame(rows), series
