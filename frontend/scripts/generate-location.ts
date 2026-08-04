import fs from "fs";
import path from "path";
import csv from "csv-parser";

interface ProvinceOption {
  province: string;
  wards: string[];
}

const INPUT = path.resolve("data/location.csv"); // CSV của bạn
const OUTPUT = path.resolve("src/lib/location.ts");

const provinces = new Map<string, Set<string>>();

fs.createReadStream(INPUT)
  .pipe(csv())
  .on("data", (row) => {
    const province =
      row["Tỉnh/TP mới"]?.trim() ||
      row["Tinh/TP moi"]?.trim();

    const ward =
      row["Phường/Xã mới (từ 1/7/2025)"]?.trim() ||
      row["Phuong/Xa moi (tu 1/7/2025)"]?.trim();

    if (!province || !ward) return;

    if (!provinces.has(province)) {
      provinces.set(province, new Set());
    }

    provinces.get(province)!.add(ward);
  })
  .on("end", () => {
    const locations: ProvinceOption[] = Array.from(provinces.entries())
      .sort((a, b) => a[0].localeCompare(b[0], "vi"))
      .map(([province, wards]) => ({
        province,
        wards: Array.from(wards).sort((a, b) => a.localeCompare(b, "vi")),
      }));

    const content = `export interface ProvinceOption {
  province: string;
  wards: string[];
}

export const locations: ProvinceOption[] = ${JSON.stringify(
      locations,
      null,
      2
    )};
`;

    fs.writeFileSync(OUTPUT, content, "utf8");

    console.log("✔ location.ts generated");
    console.log(`✔ Provinces: ${locations.length}`);

    const wardCount = locations.reduce(
      (sum, p) => sum + p.wards.length,
      0
    );

    console.log(`✔ Wards: ${wardCount}`);
  });