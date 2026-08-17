import { describe, expect, test } from "vitest"

import { labelInGroup } from "./setLabel"

/**
 * The rule that lets `Kevin & Ashlee — Anime` render as `Anime` inside Kevin & Ashlee.
 * Pinned because it is a STRING rule over labels a person types, and the failure mode is
 * silent: a near-miss just leaves the long label, which looks like the feature never shipped.
 */
describe("labelInGroup", () => {
  test("strips the group's own name and its separator", () => {
    expect(
      labelInGroup(
        "Kevin & Ashlee — Anime",
        "Kevin & Ashlee",
      ),
    ).toBe("Anime")
    expect(labelInGroup("Family — Movies", "Family")).toBe(
      "Movies",
    )
  })

  test("leaves the label alone with no group in context", () => {
    expect(labelInGroup("Kevin — Anime", null)).toBe(
      "Kevin — Anime",
    )
  })

  test("leaves a label whose prefix is somebody else", () => {
    expect(
      labelInGroup("Kevin & Sheldon — Movies", "Kevin"),
    ).toBe("Kevin & Sheldon — Movies")
    // The trap this exists for: "Kevin" IS a prefix of "Kevin & Sheldon" as a substring,
    // so a startsWith() implementation would strip it to "& Sheldon — Movies".
    expect(
      labelInGroup("Kevin & Xander — Anime", "Kevin"),
    ).toBe("Kevin & Xander — Anime")
  })

  test("leaves a label with no separator at all", () => {
    expect(labelInGroup("Manga & Webtoons", "Kevin")).toBe(
      "Manga & Webtoons",
    )
    expect(labelInGroup("Shows & Shorts", "Kids")).toBe(
      "Shows & Shorts",
    )
  })

  test("matches case-insensitively, like a person reading it", () => {
    expect(labelInGroup("KEVIN — Anime", "Kevin")).toBe(
      "Anime",
    )
  })

  test("accepts a hyphen or en dash, not just an em dash", () => {
    expect(labelInGroup("Kevin - Movies", "Kevin")).toBe(
      "Movies",
    )
    expect(labelInGroup("Kevin – Movies", "Kevin")).toBe(
      "Movies",
    )
  })

  test("never returns an empty name", () => {
    expect(labelInGroup("Kevin — ", "Kevin")).toBe(
      "Kevin — ",
    )
  })

  test("does not strip a bare match with no separator", () => {
    // A queue literally called "Kevin" inside the Kevin group keeps its name rather than
    // becoming blank.
    expect(labelInGroup("Kevin", "Kevin")).toBe("Kevin")
  })
})
