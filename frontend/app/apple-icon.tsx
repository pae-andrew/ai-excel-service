import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex",
          background: "#F0EDE4",
        }}
      >
        <div
          style={{
            width: "100%", height: "100%", display: "flex", borderRadius: 9999,
            background: "radial-gradient(circle at 30% 28%, #1F9E63, #004741 70%)",
          }}
        />
      </div>
    ),
    { ...size },
  );
}
