import type { Page, Album } from "../domain/model";
import { luminance } from "../domain/art-direction";
// Small vector tiles keep backgrounds crisp in PDF without large bitmap caches.
export function PageBackground({
  page,
  size,
}: {
  page: Page;
  size: Album["size"];
}) {
  const style = page.backgroundStyle ?? "solid",
    key = `paper-${page.id}`,
    w = size.width,
    h = size.height;
  const dark =
    /^#[a-f0-9]{6}$/i.test(page.background) && luminance(page.background) < 0.2;
  return (
    <g pointerEvents="none">
      <rect width={w} height={h} fill={page.background} />
      {style !== "solid" && (
        <>
          <defs>
            <radialGradient id={`${key}-sage`} cx="12%" cy="10%" r="85%">
              <stop
                offset="0"
                stopColor="#a8c6ba"
                stopOpacity={dark ? 0.09 : 0.5}
              />
              <stop
                offset=".6"
                stopColor="#c3d5cb"
                stopOpacity={dark ? 0.03 : 0.14}
              />
              <stop offset="1" stopColor="#c3d5cb" stopOpacity="0" />
            </radialGradient>
            <radialGradient id={`${key}-sand`} cx="90%" cy="90%" r="70%">
              <stop
                offset="0"
                stopColor="#d5bba2"
                stopOpacity={dark ? 0.08 : 0.34}
              />
              <stop offset="1" stopColor="#dfcdbb" stopOpacity="0" />
            </radialGradient>
            <pattern
              id={key}
              width={style === "grid" ? 18 : style === "dots" ? 14 : 96}
              height={style === "grid" ? 18 : style === "dots" ? 14 : 96}
              patternUnits="userSpaceOnUse"
            >
              {style === "grid" ? (
                <path
                  d="M18 0H0V18"
                  fill="none"
                  stroke={dark ? "#d9e5d6" : "#607364"}
                  strokeWidth=".45"
                  opacity=".18"
                />
              ) : style === "dots" ? (
                <circle
                  cx="2"
                  cy="2"
                  r=".65"
                  fill={dark ? "#d5dfca" : "#65756a"}
                  opacity={dark ? 0.15 : 0.25}
                />
              ) : style === "linen" ? (
                <>
                  <path
                    d={Array.from(
                      { length: 48 },
                      (_, i) => `M${i * 2} 0v96 M0 ${i * 2}h96`,
                    ).join(" ")}
                    stroke="#7a7263"
                    strokeWidth=".28"
                    opacity=".13"
                  />
                  <path
                    d={Array.from(
                      { length: 24 },
                      (_, i) => `M0 ${1 + i * 4}h96M${1 + i * 4} 0v96`,
                    ).join(" ")}
                    stroke="white"
                    strokeWidth=".3"
                    opacity={dark ? 0.12 : 0.45}
                  />
                </>
              ) : style === "wash" ? (
                <>
                  <ellipse
                    cx="25"
                    cy="20"
                    rx="42"
                    ry="24"
                    fill="#bed2c8"
                    opacity=".13"
                  />
                  <ellipse
                    cx="81"
                    cy="78"
                    rx="42"
                    ry="32"
                    fill="#e1c9b5"
                    opacity=".12"
                  />
                </>
              ) : (
                <>
                  {Array.from({ length: 44 }, (_, i) => {
                    const x = (i * 37.31) % 96,
                      y = (i * 23.19) % 96;
                    return (
                      <path
                        key={i}
                        d={`M${x} ${y}q${(i % 3) + 1} -1 ${(i % 5) + 2} ${i % 2 ? 1 : 3}`}
                        fill="none"
                        stroke={i % 3 === 0 ? "#fffdf6" : "#7c6c51"}
                        strokeWidth={style === "rice" ? 0.65 : 0.38}
                        opacity={
                          style === "kraft"
                            ? 0.17
                            : style === "rice"
                              ? 0.1
                              : 0.13
                        }
                      />
                    );
                  })}
                  {style === "rice" &&
                    Array.from({ length: 12 }, (_, i) => (
                      <path
                        key={`wisp-${i}`}
                        d={`M${(i * 41) % 96} ${(i * 29) % 96}q7 -3 14 2`}
                        stroke="#b8ad95"
                        strokeWidth="1.2"
                        fill="none"
                        opacity=".045"
                      />
                    ))}
                </>
              )}
            </pattern>
          </defs>
          {style === "wash" ? (
            <>
              <rect width={w} height={h} fill={`url(#${key}-sage)`} />
              <rect width={w} height={h} fill={`url(#${key}-sand)`} />
            </>
          ) : (
            <rect width={w} height={h} fill={`url(#${key})`} />
          )}
        </>
      )}
    </g>
  );
}
