"""Research-only arithmetic from preserved official October rate cards."""
from decimal import Decimal, ROUND_FLOOR
from hashlib import sha256
from pathlib import Path
import json

HERE = Path(__file__).resolve().parent
SOURCE = HERE / 'meta-ratecards-2026.json'
source_bytes = SOURCE.read_bytes()
source = json.loads(source_bytes)
cards = [c for c in source['cards']
         if c['kind'] == 'rates' and c['effective_from'] == '2026-10-01']
assert {c['currency'] for c in cards} == {'COP', 'USD'}


def number(value):
    return format(value, 'f')


rows = []
for card in cards:
    for row in card['rates']:
        if row['service'] == 'n/a':
            continue
        rate = Decimal(row['service'])
        assert rate > 0
        rows.append({
            'market': row['market'], 'currency': card['currency'],
            'service_rate': number(rate),
            'twenty_billable_replies': number(rate * 20),
            'thousand_billable_replies': number(rate * 1000),
            'card_file': card['source_file'], 'card_sha256': card['sha256'],
        })
rows.sort(key=lambda row: (row['currency'], -Decimal(row['service_rate']), row['market']))
assert len({(row['currency'], row['market']) for row in rows}) == len(rows)
by_key = {(row['currency'], row['market']): Decimal(row['service_rate']) for row in rows}
assert len(rows) == 94  # 47 destinations in each preserved official card.

selected = []
for market in ['Colombia', 'North America', 'Brazil', 'Mexico', 'Rest of Latin America',
               'Spain', 'Argentina', 'Peru', 'Netherlands', 'Germany']:
    cop = by_key['COP', market]
    usd = by_key['USD', market]
    selected.append({
        'market': market,
        'usd_per_reply': number(usd), 'usd_per_20': number(20 * usd),
        'cop_per_reply': number(cop), 'cop_per_20': number(20 * cop),
        'relative_to_colombia_usd': number(usd / by_key['USD', 'Colombia']),
    })

examples = {
    'country_ratio_germany_colombia_usd': number(by_key['USD', 'Germany'] / by_key['USD', 'Colombia']),
    'same_budget_cop_1000_max_billable_replies': {
        market: int((Decimal('1000') / by_key['COP', market]).to_integral_value(rounding=ROUND_FLOOR))
        for market in ['Colombia', 'Peru', 'Germany']
    },
    'germany_cop_one_reply_one_link_three_images_three_captions': {
        'effects_before': 8, 'cost_before': number(by_key['COP', 'Germany'] * 8),
        'effects_after_if_link_in_text_and_native_captions_fit': 4,
        'cost_after': number(by_key['COP', 'Germany'] * 4),
        'qualification': 'Illustrative transport optimization; not a measured saving or proof of deployment.',
    },
    'colombia_cop_2000_service_deliveries_one_number': {
        'free_allowance_remaining_1000': number(by_key['COP', 'Colombia'] * 1000),
        'free_allowance_remaining_0': number(by_key['COP', 'Colombia'] * 2000),
    },
}
assert examples['country_ratio_germany_colombia_usd'] == '68.75'
assert examples['same_budget_cop_1000_max_billable_replies'] == {'Colombia': 339, 'Peru': 9, 'Germany': 4}
assert examples['germany_cop_one_reply_one_link_three_images_three_captions']['cost_before'] == '1619.9976'

result = {
    'status': 'research_scenarios_not_runtime_policy',
    'as_of': '2026-09-10', 'effective_from': '2026-10-01',
    'source_page': source['source_page'],
    'source_file': SOURCE.name, 'source_sha256': sha256(source_bytes).hexdigest(),
    'assumptions': [
        'Service messages delivered outside an evidenced free-entry-point exemption.',
        'Free service allowance already exhausted, except in the explicitly labelled remaining-allowance example.',
        'Official account currency is used directly; COP is not converted from USD.',
        'Taxes, partner charges, AI, advertising, human labor and other categories are excluded.',
        'Example COP 1000 is arbitrary for illustrating destination impact, not a recommended customer limit.',
        'No service volume discounts are applied. No calls, contacts or production costs were measured.',
    ],
    'selected_markets': selected, 'all_markets': rows, 'examples': examples,
}
OUTPUT = HERE / 'whatsapp-response-cost-scenarios.json'
OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'Wrote {OUTPUT.name}: {len(rows)} currency/market rows; arithmetic checks passed.')
