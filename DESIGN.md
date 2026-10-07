# Kiwi AI Document Assistant — Frontend Design System Specification

## 1. Design Philosophy

Kiwi AI Document Assistant's frontend design system is built upon the principles of **restraint, precision, monochromatic engineering, and information density**. Inspired by the Vercel design reference, Kiwi avoids generic AI dashboard clichés (such as purple gradients, neon glows, excessive illustration, and bloated card bubbles) in favor of a professional developer and researcher productivity tool.

Every pixel serves a functional purpose. Content is front and center, supported by a meticulously calibrated achromatic grayscale palette, precise typography, and a single interactive accent color (`#0072F5`).

---

## 2. Color System & Theme Tokens

Kiwi uses a comprehensive CSS variable token system for seamless application-wide **Light Mode** and **Dark Mode** switching.

### Light Theme Tokens (`[data-theme="light"]` or default)
- `--bg-background`: `#FAFAFA` (Page canvas)
- `--bg-surface`: `#FFFFFF` (Cards, panels, inputs)
- `--bg-recessed`: `#F2F2F2` (Toggle tracks, subtle pills)
- `--bg-hover`: `#EBEBEB` (Interactive hover state)
- `--fg-primary`: `#171717` (Headings, primary text)
- `--fg-secondary`: `#4D4D4D` (Navigation labels, secondary text)
- `--fg-muted`: `#8F8F8F` (Metadata, captions, borders)
- `--border-color`: `rgba(0, 0, 0, 0.08)` (Shadow-as-border boundary)
- `--interactive`: `#0072F5` (Links, focus indicators, active buttons)
- `--interactive-hover`: `#005FCC` (Active/hover state for interactive elements)
- `--shadow`: `0 0 0 1px rgba(0, 0, 0, 0.08)`

### Dark Theme Tokens (`[data-theme="dark"]`)
- `--bg-background`: `#0F1015` (Deep engineering background)
- `--bg-surface`: `#181920` (Elevated cards and panels)
- `--bg-recessed`: `#222430` (Toggle tracks and recessed containers)
- `--bg-hover`: `#2A2C3A` (Hover state for list items and controls)
- `--fg-primary`: `#F3F4F6` (Primary headings and text)
- `--fg-secondary`: `#9CA3AF` (Secondary labels and metadata)
- `--fg-muted`: `#6B7280` (Disabled text and subtle borders)
- `--border-color`: `rgba(255, 255, 255, 0.08)` (Subtle white border shadow)
- `--interactive`: `#3B82F6` (Interactive blue)
- `--interactive-hover`: `#60A5FA` (Interactive hover)
- `--shadow`: `0 0 0 1px rgba(255, 255, 255, 0.08)`

---

## 3. Typography

- **UI & Body Font**: Geist Sans (with system-ui / Inter fallbacks).
- **Code & Metadata Font**: Geist Mono (with JetBrains Mono / Consolas fallbacks).
- **Weight Rule**: Strictly limited to 3 weights (400 Regular, 500 Medium, 600 Semibold). No weight 700 bold is used.
- **Negative Letter-Spacing**: Aggressive negative tracking on headings (`h1`: `-2.28px`, `h3`: `-1.28px`) to create an engineered aesthetic.

---

## 4. Spacing System (4px Base Scale)

- `--space-1`: 4px
- `--space-2`: 8px
- `--space-3`: 12px
- `--space-4`: 16px
- `--space-6`: 24px
- `--space-8`: 32px
- `--space-10`: 40px
- `--space-16`: 64px

---

## 5. Borders & Shadows (Shadow-as-Border)

Traditional CSS borders are replaced by shadow simulations:
```css
box-shadow: 0 0 0 1px var(--border-color);
```
This avoids box-model shifts and allows seamless multi-layer elevation compositions.

---

## 6. The Animated Day/Night Theme Toggle

Kiwi incorporates the exact Vercel-inspired animated sun/moon day/night toggle from `button.html` and `button.css` directly into the top header navigation. It supports full ARIA states (`aria-pressed="true/false"`), smooth CSS easing transitions, star twinkling, and persistent state saving via `localStorage`.

---

## 7. Component Specifications

1. **Header Navigation**: Fixed 54px height with collapsible sidebar, active session title, and embedded ThemeToggle.
2. **Search & Chat UI**: Clean prompt stream with markdown rendering, code copy actions, and source citations.
3. **Source Document Cards**: Minimalist document preview with direct `Open` (PDF page navigation) and `Download` capabilities.
4. **Empty State**: Centered prompt guidance with quick starter suggestions.
5. **Responsive Layout**: Fully adaptive across desktop, laptop, tablet, and mobile devices.
