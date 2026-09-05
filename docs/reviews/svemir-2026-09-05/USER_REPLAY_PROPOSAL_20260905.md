# Forwarded user proposal — 2026-09-05

Provenance: user explicitly asked Astra to acquaint Sol with this reply. The following is the proposal to evaluate, not verified findings or implementation approval. Mainnet execution remains separately gated.

**1. Merenje stoji, i strogi bracket nije „bezbedan" — on je samo drugačija selekcija.** Sa strogim bracketom igrač (ili bilo ko) i dalje bira: uhvati jedinu važeću poruku ako mu odgovara, a ako ne odgovara — ćuti i posle 180 s dobija refund (Core `void_pending_entry`/`void_active_shot` vraćaju ceo ulog na EXPIRED). To je besplatna opcija „VOID umesto gubitka", plus ~100 % VOID kad pusher nije u fazi. Dakle ni jedno ni drugo pravilo nije sigurno samo po sebi — sigurnost daje jedino to da **niko ne može da preskoči print, a da ga javni dokaz ne može pregaziti**.

**2. Pravilo koje to daje: „najmanji publish_time ≥ T" + izazov replay-em iz Solana ledgera.**

- Prihvatljiv kandidat: `publish_time ≥ T` i `publish_time − T ≤ max_post_target_lag` (po feedu, iz merenja), sve ostale provere ostaju (owner rec2, Full, feed, exponent, conf, posted_slot ≤ clock.slot).
- Više kandidata po Need-u; kanonski je onaj sa **najmanjim publish_time** (tie-break `posted_slot`). Novi kandidat sa MANJIM publish_time zamenjuje trenutnog; sa većim se odbija. AMBIGUOUS ostaje samo za dve različite Pyth-potpisane poruke sa ISTIM publish_time (praktično nemoguće, sigurnosna mreža).
- Izvor dokaza nije samo sponzorisani PDA: prihvata se i **bilo koji nalog čiji je owner Pyth receiver rec2… sa verification_level == Full i istim feed id-om** — tj. poruka koju je bilo ko ponovo objavio kroz receiver-ov `post_update`. Potpisani bajtovi preskočenog printa nisu izgubljeni: pusher-ova transakcija koja ga je upisala (i Wormhole `write_encoded_vaa` pre nje) stoji trajno u Solana ledgeru — `getSignaturesForAddress(sponzorisani PDA)` → `getTransaction` u tom slotu → isti VAA + merkle dokaz → `post_update` u svoj nalog. Bez ključa, bez Hermesa. Trošak: par transakcija + rent koji se vraća.
- **Prozor izazova**: od prvog hvatanja do `capture_deadline` (npr. 15 min, ne 180 s) bilo ko može da ubaci raniji print. Tek onda `finalize`.
- Rezidualna pretpostavka postaje: „niko u 15 minuta nije replay-ovao preskočeni print koji je javno i trajno dostupan" — umesto „neko je uhvatio tačno jednu poruku u njenih 5 sekundi života". To je isti tip pretpostavke, ali sa 180× dužim prozorom i dokazom koji ne nestaje. Ko preskoči print, samo je platio tuđi bounty.

**3. Šta je od toga već u kodu, pa je izmena mala.** `capture_conflict` već prima drugu poruku i sortira hasheve — treba mu samo pravilo „manji publish_time pobeđuje" umesto „različit hash = AMBIGUOUS". `load_evidence` treba da dobije `adapter = 3` koji preskače pin na sponzorisani PDA i `write_authority` (linije ~1250–1274 u lifecycle.rs), a zadrži owner/Full/feed. `foreign_timepin.rs::validate_record_against_spec` isti predikat. Work Market već ima `FIRST_CAPTURE` vrstu — dodati `CHALLENGE_WIN` koji plaća ko donese raniji print.

**4. Dve stvari da se izmere pre nego što se pravilo pinuje** (obe read-only, sat vremena):

- koliko često bi izbor između uzastopnih printova uopšte promenio ishod: za svaki minutni T uporediti smer (M₁ − entry) i (M₂ − entry) za horizonte 5/15/60 min — to je stvarna veličina „opcije", verovatno par procenata na 5 min i ~0 na 60 min;
- da li se pusher-ova VAA stvarno može izvući iz ledgera preko javnog RPC-a (jedan probni replay na devnetu) — to je dokaz da je izazov izvodljiv bez ključa.

**5. Ako hoćete da krenete odmah bez replay adaptera:** pravilo iz tačke 2 sa dva nezavisna cranka (PC + VPS) koji hvataju svaki otvoreni Need na T+2…T+7 s, i javno napisano: „prozor selekcije ≤ jedan push interval (5 s na SOL/BTC); zatvara ga bilo koji nezavisni capturer". To je pošteno i igrivo danas; replay-izazov se doda kao adapter 3 bez promene ekonomije. Strogi bracket ostaviti kao adapter 2 za izvor koji objavljuje svaki agregat.

Ukratko za Astru: ne tražim „manje VOID-a", tražim da nijedna strana ne može da bira, a da to izbor ne bude javno pregaziv — a to strogi bracket sa sponzorisanim PDA-om ne ispunjava jer opciju daje samom ćutanjem.
