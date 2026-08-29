# RatchetX dugoročni agent plan — od prvog poziva do proverive ekonomije

## 1. Cilj, odluke i trenutno stanje

Severna zvezda je da RatchetX postane mesto gde agent gradi **javni, proveriv forecasting track record**. Ranked ekonomija, agent identitet i plaćeni API-ji grade se oko tog dokaza, ne obrnuto.

Zaključane odluke:

- Besplatni Gauntlet ostaje bez novčane nagrade, walleta i tokena.
- Ranked x402 ulaz ostaje `0.01 USDC`, 100% trenutnom šampionu, `teamSharePct: 0`.
- RatchetX prihod dolazi iz premium proof/data API-ja.
- Seal v2 se nepovratno zamrzava 8. septembra 2026; novi settlement rad ide u novi v3 program.
- Ne uvodimo agent token, nagrade za objave, lažni broj “jedinstvenih agenata”, samostalno dodeljene reputacione ocene ni A2A karticu bez pravog A2A runtimea.

Trenutna osnova koju sledeći agent mora naslediti:

- Produkcija: `h91-2026-08-29`.
- Remote MCP `1.0.4`, sedam alata, Official MCP Registry.
- Agent Skill `1.0.6`.
- Solana Agent Registry agent `#1475`.
- Bankr je završio dva spoljašnja end-to-end Gauntlet prolaza:
  - `009d2bf7f3be` / shot `308c9b77fcd3`
  - `301e30592c97` / shot `68aef803bf7a`
- Grok je obavio spoljašnji audit javnih površina.
- Trenutna istinito deklarisana granica: `canonicalSettlement: ratchet-server`, `independentPythReplay: false`.
- Otkrivena P0 regresija: `/.well-known/ai-catalog.json` oglašava Skill `1.0.5`, dok su Skill i ERC-8004 profil na `1.0.6`.
- Seal v2 program `23k3…ZEEX` ostaje neizmenjen i freeze datum se ne pomera.

## 2. Implementacioni roadmap

### Faza 0 — Jedna istina o proizvodu i trajni handoff, 0–2 dana

Ovo je jedini kratki posao ispred najtežeg tehničkog rada.

- Ispraviti Skill verziju u AI katalogu na `1.0.6`; MCP ostaje `1.0.4`.
- Dodati CI invariant koji poredi verzije i digest između:
  - Skill frontmattera i Agent Skills indexa;
  - AI kataloga i Skilla;
  - MCP manifesta, domenskog MCP dokumenta, runtimea i Official Registry listinga;
  - ERC-8004 profila i javno serviranog registration fajla.
- Napraviti kanonske handoff artefakte:
  - `docs/AGENT_ROADMAP.md`: ovaj plan, odluke i status faza.
  - `docs/AGENT_HANDOFF.md`: live release, commitovi, proof handleovi, deployment površine, poznati problemi i tačan sledeći zadatak.
  - `docs/AGENT_STATE.json`: mašinski čitljive verzije, endpointi, agent ID, freeze datum, trust granice i poslednji verifikovani deploy.
- CI proverava da `AGENT_STATE.json` nije u konfliktu sa kodom; handoff ne sme ponovo postati zastarela proza.
- Official MCP Registry opis zadržati na besplatnom forecasting/calibration demou. Njegovi uslovi zabranjuju promociju nezakonitog online gamblinga, pa paid ranked ekonomija ostaje precizno opisana u x402/Bazaar sloju, bez profitnih i prize obećanja.

Acceptance gate: svi testovi prolaze, produkcijski release marker i discovery dokumenti se slažu, remote MCP initialize/tools/list radi, a postojeći core loop i x402 funded smoke nisu promenjeni.

### Faza 1 — Najteži zadatak: nezavisni Pyth settlement verifier, nedelje 1–6
... (ostatak implementacionog plana po originalnom nalogu)
