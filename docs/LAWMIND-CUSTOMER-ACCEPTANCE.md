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

**Governance**

- [ ] Staff understand **human review** for high-risk drafts.
- [ ] **Audit log** location explained (`workspace/audit/` and export paths).
- [ ] **Data processing** and **privacy** drafts reviewed ([LAWMIND-DATA-PROCESSING](/LAWMIND-DATA-PROCESSING), legal drafts under `/legal`).

**Notes**

---

https://docs.lawmind.ai/LAWMIND-CUSTOMER-ACCEPTANCE  
https://docs.lawmind.ai/LAWMIND-DELIVERY  
https://docs.lawmind.ai/LAWMIND-DATA-PROCESSING
