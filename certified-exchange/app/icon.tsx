import { ImageResponse } from "next/og";
import { brand } from "@/config/brand";

// Favicon generated from config/brand.ts so a rename or recolor carries through.
export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: brand.colors.accent,
          color: "white",
          fontSize: 30,
          fontWeight: 700,
          borderRadius: 12,
          letterSpacing: -1,
        }}
      >
        {brand.monogram}
      </div>
    ),
    size,
  );
}
