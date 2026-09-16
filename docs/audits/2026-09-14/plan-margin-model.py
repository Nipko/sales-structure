"""Illustrative contribution model; not measured tenant profitability.

Run from any directory with Python 3. Writes plan-margin-scenarios.json beside
this file. Prices are a 2026-09-14 public-catalog snapshot. No network or DB writes.
"""
import json
from pathlib import Path

PLANS = [
    # slug, current COP, current replies, proposed COP, proposed standard replies,
    # illustrative USD per reply, other AI/media USD, allocated support USD
    ("emprendedor", 125700, 1000, 129900, 1000, .001, .5, 2),
    ("starter", 276900, 5000, 299900, 5000, .0012, 1.5, 4),
    ("pro", 757700, 25000, 799900, 15000, .0015, 5, 10),
    ("enterprise", 1789800, 100000, 2199900, 40000, .002, 15, 25),
]

def scenario(plan, proposed=False, fx=4200, cost_override=None,
             infra_usd=5, sales_vat_included=0, discount=0):
    slug, current, old_qty, new, new_qty, unit, media, support = plan
    gross = (new if proposed else current) * (1-discount)
    qty = new_qty if proposed else old_qty
    revenue = gross / (1 + sales_vat_included)
    # Wompi public aggregator tariff. VAT on fee conservatively expensed.
    fee = (gross * .0265 + 700) * 1.19
    ai_usd = qty * (cost_override if cost_override is not None else unit)
    cost = (ai_usd + media + support + infra_usd) * fx + fee + 250
    return dict(plan=slug, proposed=proposed, price_collected_cop=round(gross, 2),
                revenue_net_cop=round(revenue, 2), replies=qty,
                ai_cost_usd=round(ai_usd, 4), wompi_fee_cop=round(fee, 2),
                modeled_cost_cop=round(cost, 2),
                contribution_cop=round(revenue-cost, 2),
                contribution_percent=round(100*(revenue-cost)/revenue, 2))

result = {
    "kind": "proposal_and_sensitivity_not_measured_profitability",
    "assumptions": {
        "fx_cop_per_usd": 4200, "fx_stress": 4800,
        "infra_allocation_usd_per_paying_tenant": 5,
        "invoice_cost_cop_assumed": 250,
        "wompi": "(collected_COP * 0.0265 + 700) * 1.19",
        "sales_tax_base": "0 for illustration, not a tax determination",
        "support_usd_by_plan": [2, 4, 10, 25],
        "other_ai_media_usd_by_plan": [.5, 1.5, 5, 15],
        "average_ai_usd_per_reply_by_plan": [.001, .0012, .0015, .002],
        "stress_ai_usd_per_reply": .008,
        "excludes": ["Meta paid directly by tenant", "CAC", "product development",
                     "general administration", "income tax", "refunds and chargebacks"],
    },
    "current_reference": [scenario(p) for p in PLANS],
    "current_expensive_turns": [scenario(p, cost_override=.008) for p in PLANS],
    "proposal_reference": [scenario(p, proposed=True) for p in PLANS],
    "proposal_fx_stress": [scenario(p, proposed=True, fx=4800) for p in PLANS],
    "proposal_if_display_price_includes_19pct_sales_vat": [
        scenario(p, proposed=True, sales_vat_included=.19) for p in PLANS],
    "proposal_annual_10pct_monthly_equivalent": [
        # Conservative: retains one fixed PSP fee/month although annual collection
        # would ordinarily have one fixed fee/year. Quotas still reset monthly.
        scenario(p, proposed=True, discount=.10) for p in PLANS],
    "meta_10000_service_deliveries_one_number_usd": {
        country: round(9000 * rate, 2)
        for country, rate in {"CO": .0008, "BR": .0068, "MX": .0085,
                              "CL": .02, "AR": .026, "PE": .03}.items()},
    "aws_fixed_cost_per_paying_tenant_usd": {
        str(cost): {str(n): round(cost/n, 2) for n in [20, 50, 100, 200, 500]}
        for cost in [300, 600, 1000]},
    "fargate_us_east_1_6vcpu_12gb_730hours": round(
        730 * 3600 * (6 * .000011244 + 12 * .000001235), 2),
}
Path(__file__).with_name("plan-margin-scenarios.json").write_text(
    json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
for section in ["current_reference", "current_expensive_turns", "proposal_reference",
                "proposal_fx_stress", "proposal_if_display_price_includes_19pct_sales_vat"]:
    print(section, [(r["plan"], r["contribution_percent"]) for r in result[section]])
