---
name: Fantis
description: A quiet, Linear-inspired fantasy football companion — rankings, rosters, and transparent trade math.
colors:
  cool-slate-canvas: "#10131A"
  raised-panel: "#141821"
  hairline: "#262B34"
  hairline-soft: "#1C1F27"
  bone-white: "#EEF0F3"
  muted-slate: "#939AA6"
  dim-slate: "#5D6470"
  signal-amber: "#FFB020"
  signal-amber-tint: "rgba(255,176,32,.14)"
  fresh-mint: "#37E0B0"
  alert-red: "#FF5D5D"
  position-qb: "#5FDA9C"
  position-rb: "#59B4E8"
  position-wr: "#F0808A"
  position-te: "#F0B876"
  position-other: "#8A93A3"
  scrim: "rgba(8,10,14,.7)"
  spinner-track: "rgba(255,255,255,.18)"
typography:
  display:
    fontFamily: "Inter, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "clamp(34px, 5vw, 56px)"
    fontWeight: 700
    lineHeight: 1.08
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Inter, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "32px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Inter, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.005em"
  subtitle:
    fontFamily: "Inter, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
  stat:
    fontFamily: "Inter, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "normal"
  body-lg:
    fontFamily: "Inter, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "16px"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "normal"
  control-text:
    fontFamily: "Inter, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
  body:
    fontFamily: "Inter, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "normal"
  caption:
    fontFamily: "Inter, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
  label:
    fontFamily: "Inter, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "10.5px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.07em"
  micro:
    fontFamily: "Inter, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "9px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "normal"
rounded:
  micro: "3px"
  chip: "5px"
  avatar: "6px"
  sm: "7px"
  control: "8px"
  panel-sm: "9px"
  md: "10px"
  card: "12px"
  photo: "14px"
  lg: "16px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "10px"
  md: "14px"
  lg: "20px"
  xl: "30px"
components:
  button-primary:
    backgroundColor: "{colors.signal-amber}"
    textColor: "{colors.cool-slate-canvas}"
    rounded: "{rounded.control}"
    padding: "11px 18px"
  button-primary-hover:
    backgroundColor: "{colors.signal-amber}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.bone-white}"
    rounded: "{rounded.control}"
    padding: "7px 11px"
  input:
    backgroundColor: "{colors.cool-slate-canvas}"
    textColor: "{colors.bone-white}"
    rounded: "{rounded.control}"
    padding: "11px 12px"
---

# Design System: Fantis

## Overview

**Creative North Star: "The Quiet Ledger"**

Fantis reads like a well-kept ledger, not a scoreboard: numbers stated plainly, one color spent deliberately, everything else quiet enough to stay out of the way of the data. The system exists because fantasy tools default to loud — gradients, glowing accents, condensed display type shouting "stats." Fantis's positioning is transparent, inspectable trade math; the surface has to earn that same trust by being legible and unhurried rather than persuasive.

The canvas is a lifted near-black with a cool blue-grey undertone, not true black — pure black read as flat against the rest of the palette. Tabular data (standings, rankings, rosters) uses hairline row dividers instead of boxed card panels, the way a ledger uses rules instead of boxes. Amber is the one accent, spent on active states, live values, and primary actions — never decoration. The one deliberate exception to "quiet" is the trade verdict bar's mint-vs-amber duality, a callback to the product's original scoreboard identity, kept because the trade calculator is the one moment where a visible "winner" is the point.

This is an established, explicitly protected identity (see `CLAUDE.md`) — this file documents what already exists in `app/globals.css`; it is not a proposal.

**Key Characteristics:**
- Near-black canvas with a cool undertone, never true black
- One accent color (amber), spent sparingly on state and action
- Hairline dividers instead of card chrome for tabular content
- Single type family (Inter) throughout — no dedicated display face
- Flat surfaces; depth comes from tone (ink vs. panel), not shadow
- Position and tier color-coding as soft tinted chips, never solid fills

## Colors

Quiet neutrals carry the page; amber is the only saturated color spent on UI chrome, and it's rationed.

### Primary
- **Signal Amber** (`#FFB020`): the one accent — active tab underline, active filter chip, primary buttons, live/season point values, Side B of the trade verdict. Used on a small minority of any given screen; its rarity is the point.

### Secondary
- **Fresh Mint** (`#37E0B0`): reserved for exactly two things — the "live" sync status dot/eyebrow and Side A of the trade verdict bar. Never used as a general-purpose accent.

### Tertiary
- **Alert Red** (`#FF5D5D`): errors and negative states only (failed sync, error hints, the remove-icon hover state).

### Neutral
- **Cool Slate Canvas** (`#10131A`): page background. Deliberately not pure black — reads flat next to the rest of the palette.
- **Raised Panel** (`#141821`): the one level of surface elevation — cards, side-by-side trade panels, the sticky rankings detail panel, modals.
- **Hairline** (`#262B34`): standard borders and dividers — the primary separator language, replacing card chrome in tables.
- **Hairline Soft** (`#1C1F27`): lower-contrast dividers (inside a slot/row) and hover backgrounds for clickable rows.
- **Bone White** (`#EEF0F3`): primary text.
- **Muted Slate** (`#939AA6`): secondary text — sub-labels, hint text upgraded one step, inactive tab text.
- **Dim Slate** (`#5D6470`): tertiary text — hints, uppercase column-header labels, placeholder-weight metadata.
- **Scrim** (`rgba(8,10,14,.7)`): the player-card modal's background overlay. Not a UI surface color — an overlay treatment, used nowhere else.
- **Spinner Track** (`rgba(255,255,255,.18)`): the faint ring behind the loading spinner's amber arc. A near-transparent utility value, not a palette color in its own right.

### Position Colors (signature palette)
- **Position QB** (`#5FDA9C`), **Position RB** (`#59B4E8`), **Position WR** (`#F0808A`), **Position TE** (`#F0B876`), **Position Other** (`#8A93A3`, K/DEF): a fixed, memorized color per position, used consistently across Rankings, Trade, Start/Sit, and League view so a player's position is recognizable by color alone before reading the text.

### Named Rules
**The One Accent Rule.** Amber is the only saturated color used for UI chrome/action. Every other color on screen is either a neutral or a semantic signal (position, tier, live status, error) — never decorative.

**The Mint Exception.** Fresh Mint exists only for the trade verdict bar and the live-sync indicator. Do not reach for it as a second general accent.

## Typography

**Display Font:** Inter (with -apple-system, "Segoe UI", sans-serif fallback)
**Body Font:** Inter
**Label Font:** Inter, uppercase + letter-spaced, not a distinct family

**Character:** One typeface for everything, doing all the work through weight, size, and case rather than a second face. Deliberately not "condensed sports-display" — that was the old scoreboard identity this system replaced.

### Hierarchy
- **Display** (700, `clamp(34px, 5vw, 56px)`, 1.08 line-height): the Leagues landing hero only ("Win your fantasy league."). The single loudest moment in the app; used nowhere else.
- **Headline** (700, 32px, 1.2): player-card name in the detail modal — the only other place text goes this large.
- **Title** (600, 19px, 1.3, -0.005em): section headings ("Rankings", "Trade calculator", "Start / Sit", league name).
- **Subtitle** (600, 17px): the Rankings detail panel's player name, chart section labels.
- **Stat** (700, 26px): large numeric callouts — the trade calculator's total, player-card stat values.
- **Body Large** (500, 16px): sub-copy under the landing hero, the trade verdict label, hub team name.
- **Control Text** (500, 14px): text inside form controls — inputs, selects, buttons — and a few larger body contexts (roster rows, panel labels).
- **Body** (500, 13px): the most common text size in the app — results, tabs, general UI text.
- **Caption** (500, 12px): secondary/meta text — hint lines, sub-labels, roster meta.
- **Label** (600, 10.5px, uppercase, 0.07em tracking): table column headers, tier/position micro-labels.
- **Micro** (700, 9px): the smallest text in the app — the sort-column arrow glyph and the position-power bar's in-segment rank digit (that digit occasionally drops to 7px where the bar segment is too narrow for 9px to fit; treat 7px as Micro's floor, not a separate step).

Sizes are tuned in half-pixel increments around these anchors on individual components (e.g. 13.5px on some table cells beside 13px Body, 15px/15.5px beside 16px Body Large) — that fine adjustment is intentional per-component polish, not a separate named step for every value.

### Named Rules
**The One Face Rule.** Every weight and size on screen comes from Inter. A second family (even a mono for "data") is not part of this system.

## Layout

Content sits in a `max-width: 1440px` container with 24px side padding. Sections stack vertically with generous vertical rhythm (`.sec { padding: 30px 0 }`); a persistent top nav (tabs, not a sidebar) switches between the app's five surfaces. Tabular surfaces (Rankings, League view, Start/Sit) use CSS grid rows with fixed column tracks per data shape rather than a generic table element, so numeric columns stay aligned and right-set. The Rankings detail panel goes side-by-side with the table above 880px and stacks below it — the system's one adaptive two-column layout.

## Elevation & Depth

Flat by default. There is no shadow vocabulary in this system — depth comes from tonal layering (Cool Slate Canvas for the base, Raised Panel one step up) and hairline borders, not blur or offset shadows. The only exception is the modal scrim (`rgba(8,10,14,.7)` background dim), which is an overlay treatment, not an elevation shadow.

### Named Rules
**The Flat-By-Default Rule.** Surfaces separate by tone and a 1px hairline border, never by shadow. If something needs to read as "above" the page, it's a modal with a scrim, not a card with a drop shadow.

## Shapes

Radius scales with a surface's role, not its size, across a finer-grained ladder than most systems need because it grew per-component rather than off a fixed set: micro touches (bar-chart end caps) at 3px; badges and position chips at 5px; small round avatars/marks at 6px; the small-button/filter-chip variant at 7px; the default interactive control (input, button, standard chip) at 8px; a secondary panel size (search results, avatar cards) at 9px; the default panel/card/list-row radius at 10px; the Rankings detail panel and admin list at 12px; player photos at 14px; the one full-screen modal at 16px; anything meant to read as a tag or status (pills, filter chips, the tier dot) is fully round (999px). Circular avatars/photos use `50%`, a special case for perfectly round images rather than a step on this scale. Borders are always 1px and always Hairline or Hairline Soft — never a heavier weight, never a color border used for structure (color-coded borders are reserved for the tier left-edge stripe, a semantic signal, not a structural one).

## Components

### Buttons
- **Shape:** 8px radius.
- **Primary:** Signal Amber background, Cool Slate Canvas text, 600 weight, `11px 18px` padding. Hover brightens (`filter: brightness(1.08)`); disabled drops to 50% opacity.
- **Ghost:** transparent background, Bone White text, 1px Hairline border. Used for secondary actions ("← All leagues", "Set your lineup →").
- **Small variant:** `7px 11px` padding, 13px text — used for inline/secondary actions within a dense section.

### Chips
- **Filter chip** (position/mode toggles): transparent by default, Muted Slate text; active state is Signal Amber Tint background with Signal Amber text — no border change, just fill + color.
- **Position chip** (signature component): tinted background at 20% of the position color, border at 52% of the position color, text in the full position color — via `color-mix(in srgb, <position-color> N%, transparent)`. Never a solid fill; the tint is what keeps four saturated position colors from competing on a dense page.
- **Status chip** ("Sleeper — live", "ESPN — coming soon"): Hairline border, Muted Slate text; the live variant recolors to Fresh Mint with a mint-tinted border.

### Cards / Containers
- **Corner Style:** 10px (12px for the Rankings detail panel and admin tier list).
- **Background:** Raised Panel on Cool Slate Canvas.
- **Shadow Strategy:** none — see Elevation & Depth.
- **Border:** 1px Hairline.
- **Internal Padding:** 14–20px depending on density (compact list rows vs. a standalone panel).

### Inputs / Fields
- **Style:** Cool Slate Canvas background (one step darker than its Raised Panel container), 1px Hairline border, 8px radius.
- **Focus:** border recolors to Signal Amber — no glow or ring.

### Navigation
- **Style:** flat text tabs, no pill/underline chrome except a 1.5px Signal Amber bottom border on the active tab. Inactive tabs are Muted Slate, hover promotes to Bone White. Same pattern reused inside the player-card modal for its internal tabs.

### Tier Indicator (signature component)
A player's rank tier (S through G, 8 tiers) shows as a 3px colored left-edge stripe on its table row (not a dot beside the name — that read as competing with the position chip's color). Each tier has a fixed, memorized hex from a dedicated 8-color scale independent of the position palette.

## Do's and Don'ts

### Do:
- **Do** spend Signal Amber only on the active/primary/live signal — if amber is more than roughly a tenth of what's on screen, pull it back.
- **Do** use hairline dividers for tabular content instead of wrapping every row in a card.
- **Do** tint position and tier colors via `color-mix` rather than a solid fill.
- **Do** keep all type in Inter; differentiate hierarchy with weight, size, and case, not a second face.

### Don't:
- **Don't** introduce a second saturated accent (no purple/indigo, no gradient) — this is the "generic AI SaaS" look the system explicitly rejects.
- **Don't** reach for a shadow for elevation; use tone + hairline border instead.
- **Don't** revert to the original scoreboard identity's condensed uppercase display type or solid-color position badges.
- **Don't** put a colored border on a card, list item, or callout as a structural device — color-coded borders are reserved for the tier stripe's semantic signal.
