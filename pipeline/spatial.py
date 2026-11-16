"""Spatial statistics on district polygons, implemented directly (numpy + shapely) to keep dependencies light.

Queen contiguity -> global Moran's I, local Moran (LISA) clusters and Getis-Ord Gi* hot spots,
with permutation-based pseudo p-values.
"""
import numpy as np
from shapely import STRtree


def adjacency(geoms, ids, lats, lons, tol=0.004):
    """Queen contiguity. Islands are linked to their nearest district so every unit has a neighbour."""
    tree = STRtree(list(geoms))
    buf = [g.buffer(tol) for g in geoms]
    a, b = tree.query(buf, predicate="intersects")
    n = len(ids)
    W = np.zeros((n, n))
    W[a, b] = 1
    W = np.maximum(W, W.T)
    np.fill_diagonal(W, 0)
    xy = np.c_[np.asarray(lons), np.asarray(lats)]
    for i in np.where(W.sum(1) == 0)[0]:
        d = ((xy - xy[i]) ** 2).sum(1)
        d[i] = np.inf
        j = int(d.argmin())
        W[i, j] = W[j, i] = 1
    return W


def row_std(W):
    return W / W.sum(1, keepdims=True)


def moran(x, W, perms=999, seed=0):
    rng = np.random.default_rng(seed)
    Wr = row_std(W)
    z = (x - x.mean()) / x.std()
    I = float(z @ Wr @ z / len(z))
    sims = np.array([(zp := rng.permutation(z)) @ Wr @ zp / len(z) for _ in range(perms)])
    p = float((np.sum(sims >= I) + 1) / (perms + 1))
    return {"I": I, "p": p, "expected": -1 / (len(z) - 1), "z": float((I - sims.mean()) / sims.std())}


def lisa(x, W, perms=999, seed=0, alpha=0.05):
    """Local Moran with conditional permutation. Labels: HH, LL, HL, LH or ns (not significant)."""
    rng = np.random.default_rng(seed)
    Wr = row_std(W)
    z = (x - x.mean()) / x.std()
    lag = Wr @ z
    Ii = z * lag
    n = len(z)
    p = np.ones(n)
    for i in range(n):
        nb = np.where(W[i] > 0)[0]
        others = np.delete(z, i)
        sims = np.array([z[i] * rng.choice(others, len(nb), replace=False).mean() for _ in range(perms)])
        p[i] = (np.sum(np.abs(sims) >= abs(Ii[i])) + 1) / (perms + 1)
    lab = np.where(z >= 0, np.where(lag >= 0, "HH", "HL"), np.where(lag >= 0, "LH", "LL"))
    lab = np.where(p <= alpha, lab, "ns")
    return Ii, p, lab, lag


def gi_star(x, W):
    """Getis-Ord Gi* z-score (neighbourhood includes the district itself)."""
    Ws = W + np.eye(len(x))
    n, xb, s = len(x), x.mean(), x.std()
    sw = Ws.sum(1)
    num = Ws @ x - xb * sw
    den = s * np.sqrt((n * (Ws ** 2).sum(1) - sw ** 2) / (n - 1))
    return num / den
