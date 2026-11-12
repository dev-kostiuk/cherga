#!/usr/bin/env python3
"""Build a compact settlement index from the KATOTTG settlements CSV."""

import csv
import json
import sys
from pathlib import Path

OBLASTS = {
    "Вінницька": ("vinnytsia", "Вінницька область"),
    "Волинська": ("volyn", "Волинська область"),
    "Дніпропетровська": ("dnipro", "Дніпропетровська область"),
    "Донецька": ("donetsk", "Донецька область"),
    "Житомирська": ("zhytomyr", "Житомирська область"),
    "Закарпатська": ("zakarpattia", "Закарпатська область"),
    "Запорізька": ("zaporizhzhia", "Запорізька область"),
    "Івано-Франківська": ("ivano-frankivsk", "Івано-Франківська область"),
    "Київська": ("kyiv", "Київська область"),
    "Кіровоградська": ("kirovohrad", "Кіровоградська область"),
    "Луганська": ("luhansk", "Луганська область"),
    "Львівська": ("lviv", "Львівська область"),
    "Миколаївська": ("mykolaiv", "Миколаївська область"),
    "Одеська": ("odesa", "Одеська область"),
    "Полтавська": ("poltava", "Полтавська область"),
    "Рівненська": ("rivne", "Рівненська область"),
    "Сумська": ("sumy", "Сумська область"),
    "Тернопільська": ("ternopil", "Тернопільська область"),
    "Харківська": ("kharkiv", "Харківська область"),
    "Херсонська": ("kherson", "Херсонська область"),
    "Хмельницька": ("khmelnytskyi", "Хмельницька область"),
    "Черкаська": ("cherkasy", "Черкаська область"),
    "Чернівецька": ("chernivtsi", "Чернівецька область"),
    "Чернігівська": ("chernihiv", "Чернігівська область"),
    "Автономна Республіка Крим": ("crimea", "Автономна Республіка Крим"),
}

KINDS = {
    "місто": "м",
    "село": "с",
    "селище": "щ",
    "селище міського типу": "т",
}

SPECIAL = {
    "Київ": ("kyiv-city", "м. Київ"),
    "Севастополь": ("sevastopol", "м. Севастополь"),
}


def main() -> None:
    source = Path(sys.argv[1])
    target = Path(sys.argv[2])
    oblasts: list[dict[str, str]] = []
    oblast_index: dict[str, int] = {}
    raions: list[str] = []
    raion_index: dict[str, int] = {}
    hromadas: list[str] = []
    hromada_index: dict[str, int] = {}
    places: list[list[object]] = []

    def oblast_id(slug: str, name: str) -> int:
        if slug not in oblast_index:
            oblast_index[slug] = len(oblasts)
            oblasts.append({"slug": slug, "name": name})
        return oblast_index[slug]

    def word_id(bucket: list[str], index: dict[str, int], value: str) -> int:
        key = value.strip()
        if key not in index:
            index[key] = len(bucket)
            bucket.append(key)
        return index[key]

    with source.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle, delimiter=";"):
            name = row["name"].strip()
            if not name:
                continue
            raw = row["oblast"].strip()
            if raw:
                mapped = OBLASTS.get(raw)
                if mapped is None:
                    raise SystemExit(f"невідома область: {raw}")
                slug, label = mapped
            else:
                mapped = SPECIAL.get(name)
                if mapped is None:
                    raise SystemExit(f"населений пункт без області: {name}")
                slug, label = mapped
            kind = KINDS.get(row["type"].strip(), "с")
            places.append(
                [
                    name,
                    oblast_id(slug, label),
                    word_id(raions, raion_index, row["raion"]),
                    word_id(hromadas, hromada_index, row["hromada"]),
                    kind,
                ]
            )

    payload = {
        "oblasts": oblasts,
        "raions": raions,
        "hromadas": hromadas,
        "places": places,
    }
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(places)} places, {len(oblasts)} oblasts, {target.stat().st_size} bytes")


if __name__ == "__main__":
    main()
