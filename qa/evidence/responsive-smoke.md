# Local responsive smoke — 2026-11-27

Target: isolated QA build at `http://127.0.0.1:4173/`, public home shell only. `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` were blank; connection warning displayed. No Supabase service or production app was contacted.

| Viewport | `innerWidth × innerHeight` | `documentElement.scrollWidth × scrollHeight` | Horizontal overflow |
|---|---:|---:|---|
| Mobile | 390 × 844 | 375 × 881 | No |
| Desktop | 1280 × 800 | 1265 × 839 | No |

Both layouts rendered header/navigation, hero text, description, and Explore button. Screenshot visuals and accessibility tree inspected in-session at each viewport; screenshot files were not saved. This was a home-shell smoke only; no login, booking, role, or data flows. Axe and Lighthouse were not run. Temporary viewport override reset; local preview server stopped.
