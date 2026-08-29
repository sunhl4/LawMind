# LawMind customer acceptance (printable)

Use this checklist at **go-live** or **pilot exit**. Items mirror [LawMind delivery](/LAWMIND-DELIVERY) section 8 with space for sign-off.

**Parties**

| Role                                   | Name | Signature | Date |
| -------------------------------------- | ---- | --------- | ---- |
| Customer technical owner               |      |           |      |
| Customer legal / compliance (optional) |      |           |      |
| Vendor / integrator                    |      |           |      |

**Environment**

- [ ] Target machines meet Node / OS requirements in [LawMind delivery](/LAWMIND-DELIVERY) (if using dev install path).
- [ ] Desktop install path tested (zip/dmg/portable per delivery package).

**Functional**

- [ ] `lawmind:acceptance --strict-env` (or customer-equivalent acceptance command) **passed** on a reference machine.
- [ ] `lawmind:ops doctor --deep` **passed** on a reference machine.
- [ ] Customer smoke and demo scripts **passed** on customer hardware.
- [ ] `.env.lawmind` (or agreed secret location) **completed** with approved model endpoints and keys.
- [ ] Lawyer can complete: 对话交办 → 澄清 → 在办定位 → 进入文书台 → 来源核验 → 签批/导出.
- [ ] Background revision completion does not forcibly navigate away from the lawyer’s current work.
- [ ] **Citation honesty:** Staff understand Firm/Private `citationGateStrict` blocks export when research snapshot shows missing source IDs or long unanchored sections; Solo does **not** hard-block by default. LawMind is **not** a substitute for Westlaw/北大法宝-class authority corpora — workspace heuristics + optional web search only.

**Governance**

- [ ] Staff understand **human review** for high-risk drafts.
- [ ] Staff understand that generated / rendered / approved / delivered are distinct states.
- [ ] Staff understand citation banners and acceptance/reasoning gates are distinct from attorney liability.
- [ ] Intake matters remain in **接洽中** until conflict check and engagement acceptance are confirmed.
- [ ] Matter sensitivity (`normal` / `high` / `restricted`) is agreed; cross-matter search is disabled unless explicitly authorized.
- [ ] **Audit log** location explained (`workspace/audit/` and export paths).
- [ ] **Data processing** and **privacy** drafts reviewed ([LAWMIND-DATA-PROCESSING](/LAWMIND-DATA-PROCESSING), legal drafts under `/legal`).

**Notes**

---

https://docs.lawmind.ai/LAWMIND-CUSTOMER-ACCEPTANCE  
https://docs.lawmind.ai/LAWMIND-DELIVERY  
https://docs.lawmind.ai/LAWMIND-DATA-PROCESSING
