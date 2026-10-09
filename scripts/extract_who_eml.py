"""Turns the WHO Model List of Essential Medicines export into a small CSV for the
medication list build (scripts/build-medication-list.mjs).

Get the export from https://list.essentialmeds.org/ (Export -> Excel), then run:

    python scripts/extract_who_eml.py path/to/eml.xlsx

It writes scripts/data/who-essential-medicines.csv with one row per medicine on the
current list: name, EML section and ATC codes. Uses only the standard library (an .xlsx
file is a zip of XML documents).

The WHO list is (c) World Health Organization, licensed CC BY-NC-SA 3.0 IGO.
"""

import csv
import re
import sys
import zipfile
import xml.etree.ElementTree as ElementTree
from pathlib import Path

SPREADSHEET_NAMESPACE = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
OUTPUT = Path(__file__).resolve().parent / "data" / "who-essential-medicines.csv"


def column_letters(cell_reference: str) -> str:
    return re.match(r"[A-Z]+", cell_reference).group(0)


def read_rows(xlsx_path: Path) -> list[dict[str, str]]:
    archive = zipfile.ZipFile(xlsx_path)
    shared_strings = [
        "".join(text.text or "" for text in item.iter(f"{SPREADSHEET_NAMESPACE}t"))
        for item in ElementTree.fromstring(archive.read("xl/sharedStrings.xml")).findall(f"{SPREADSHEET_NAMESPACE}si")
    ]
    sheet = ElementTree.fromstring(archive.read("xl/worksheets/sheet1.xml"))
    table = []
    for row in sheet.iter(f"{SPREADSHEET_NAMESPACE}row"):
        # Empty cells are simply absent, so place each value by its column letter.
        values = {}
        for cell in row.findall(f"{SPREADSHEET_NAMESPACE}c"):
            value = cell.find(f"{SPREADSHEET_NAMESPACE}v")
            if cell.get("t") == "s" and value is not None:
                text = shared_strings[int(value.text)]
            elif cell.get("t") == "inlineStr":
                text = "".join(part.text or "" for part in cell.iter(f"{SPREADSHEET_NAMESPACE}t"))
            else:
                text = value.text if value is not None else ""
            values[column_letters(cell.get("r"))] = text
        table.append(values)
    header = table[0]
    return [{header[letter]: row.get(letter, "") for letter in header} for row in table[1:]]


def main() -> None:
    rows = read_rows(Path(sys.argv[1]))
    statuses = sorted({row.get("Status", "") for row in rows})
    current = [row for row in rows if row.get("Status", "").lower() not in ("deleted", "removed")]
    seen = set()
    OUTPUT.parent.mkdir(exist_ok=True)
    with OUTPUT.open("w", newline="", encoding="utf-8") as output:
        writer = csv.writer(output)
        writer.writerow(["name", "section", "atc_codes"])
        for row in current:
            name = row["Medicine name"].strip()
            if not name or name.lower() in seen:
                continue
            seen.add(name.lower())
            writer.writerow([name, row.get("EML section", "").strip(), row.get("ATC codes", "").strip()])
    print(f"{len(rows)} rows (statuses: {', '.join(statuses)}); wrote {len(seen)} medicines to {OUTPUT}")


if __name__ == "__main__":
    main()
