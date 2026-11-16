"""Master timeline: scene starts, voice placement, caption windows. Everything else reads work/plan.json."""
import json

DUR = json.load(open("work/vo_durations.json"))
EN = {
 1: "After the rain, water collects in places we forget to look.",
 2: "For a parent, a health officer and an analyst, the questions are different. The need is the same: know sooner.",
 3: "This is Dengue Buster: a two-week outlook for every district in Malaysia.",
 4: "Type where you are. See your district's risk, and what is happening within a few kilometres.",
 5: "Then, simple steps that fit the risk level.",
 6: "Open the map. Switch layers: rain, density, schools, construction.",
 7: "Every estimate shows its reasons and its range, and who is most exposed.",
 8: "For field teams, a ranked list of schools, kindergartens and building sites. Priorities to inspect first, not findings about any site.",
 9: "And for analysts, the evidence in the open: what predicts dengue, what does not, and how often the forecast missed.",
 10: "In English or Bahasa Malaysia. Light or dark.",
 11: "Built on open data, refreshed every day. District figures are estimates, so we show you the range.",
 12: "Check your surroundings. Clear standing water. Look out for each other.",
}
MS = {
 1: "Selepas hujan, air bertakung di tempat yang kita terlupa periksa.",
 2: "Bagi ibu bapa, pegawai kesihatan dan penganalisis, soalannya berbeza. Keperluannya sama: tahu lebih awal.",
 3: "Inilah Dengue Buster: unjuran dua minggu untuk setiap daerah di Malaysia.",
 4: "Taip lokasi anda. Lihat risiko daerah anda dan apa yang berlaku dalam lingkungan beberapa kilometer.",
 5: "Kemudian, langkah mudah yang sesuai dengan tahap risiko.",
 6: "Buka peta. Tukar lapisan: hujan, kepadatan, sekolah, pembinaan.",
 7: "Setiap anggaran memaparkan sebab dan julatnya, serta siapa yang paling terdedah.",
 8: "Bagi pasukan lapangan, senarai tersusun sekolah, tadika dan tapak pembinaan. Keutamaan untuk diperiksa dahulu, bukan dapatan tentang mana-mana tapak.",
 9: "Dan bagi penganalisis, bukti secara terbuka: apa yang meramal denggi, apa yang tidak, dan berapa kerap ramalan tersasar.",
 10: "Dalam Bahasa Inggeris atau Bahasa Malaysia. Cerah atau gelap.",
 11: "Dibina atas data terbuka, dikemas kini setiap hari. Angka daerah ialah anggaran, jadi kami tunjukkan julatnya.",
 12: "Semak persekitaran anda. Bersihkan air bertakung. Saling menjaga.",
}
START = {1: 0, 2: 6, 3: 13, 4: 18, 5: 29, 6: 36, 7: 47, 8: 54, 9: 64, 10: 73, 11: 79, 12: 85}
# voice start, in seconds on the master timeline
VO_AT = {1: 0.9, 2: 6.2, 3: 13.5, 4: 20.0, 5: 29.4, 6: 37.5, 7: 48.0, 8: 54.4, 9: 64.4, 10: 73.3, 11: 79.0, 12: 85.6}
plan = {"total": 92, "live_start": 18, "live_len": 61, "start": START, "vo_at": VO_AT, "vo_dur": {int(k): v for k, v in DUR.items()}, "captions": []}
for k in range(1, 13):
    a, b = VO_AT[k] - 0.15, VO_AT[k] + plan["vo_dur"][k] + 0.35
    plan["captions"].append({"scene": k, "a": round(a, 2), "b": round(b, 2), "en": EN[k], "ms": MS[k]})
    assert b <= (START.get(k + 1, 92)) + 0.4, (k, b)
json.dump(plan, open("work/plan.json", "w"), indent=1)
print("plan ok; latest caption end:", max(c["b"] for c in plan["captions"]))
