"""The simulated payment page (port of `controllers/mockPay.controller.ts`; FR-PAY-02, FR-DEM-07).

Mounted only with `PAYMENT_PROVIDER=mock`. It says on its face that it is a
simulation, in both languages, and takes no card or wallet details.
"""

from __future__ import annotations

from urllib.parse import quote

from ..core.errors import not_found
from ..core.http import ApiRequest, Reply, raw_reply
from ..i18n import format_taka, tp
from ..services import payment as payments

PAGE_POLICY = (
    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
)


def _checkout_of(req: ApiRequest) -> str:
    value = req.params.get("checkoutId")
    if not isinstance(value, str) or value == "":
        raise not_found("route parameter")
    return value


def _encode_uri(value: str) -> str:
    # encodeURI: everything a URI may hold stays as it is.
    return quote(value, safe="-_.!~*'();/?:@&=+$,#")


def page(req: ApiRequest) -> Reply:
    checkout_id = _checkout_of(req)
    attempt = payments.mock_attempt(checkout_id)
    if attempt is None:
        raise not_found("payment")
    amount = f"{format_taka(attempt['amountPoisha'], 'bengali')} · {format_taka(attempt['amountPoisha'], 'latin')}"

    def link(outcome: str, key: str) -> str:
        href = _encode_uri(f"{checkout_id}/{outcome}")
        return f'<a class="{outcome}" href="{href}">{tp(key, "bn")}<br><small>{tp(key, "en")}</small></a>'

    choices = (
        f"{link('paid', 'mockPayPay')}{link('failed', 'mockPayFail')}{link('cancelled', 'mockPayCancel')}"
        if attempt["outcome"] == "initiated"
        else f"<p>{tp('mockPayDone', 'bn')}</p>"
    )
    html = f"""<!doctype html>
<html lang="bn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{tp('mockPayTitle', 'bn')}</title>
<style>
body{{font-family:system-ui,sans-serif;max-width:28rem;margin:2rem auto;padding:0 1rem;line-height:1.7;color:#1b2430;background:#fff}}
.note{{border:2px dashed #b45309;padding:.75rem 1rem;border-radius:.5rem;background:#fff7ed}}
a{{display:block;text-align:center;padding:.9rem;margin:.75rem 0;border-radius:.5rem;text-decoration:none;font-weight:600;color:#fff}}
.paid{{background:#1d4ed8}}.failed{{background:#b91c1c}}.cancelled{{background:#4b5563}}
small{{font-weight:400}}
</style></head><body>
<p class="note"><strong>{tp('mockPayTitle', 'bn')}</strong><br>{tp('mockPayNote', 'bn')}<br><small>{tp('mockPayNote', 'en')}</small></p>
<p>{tp('mockPayAmount', 'bn')}: <strong>{amount}</strong></p>
{choices}
</body></html>"""
    return raw_reply(
        html.encode("utf8"), "text/html; charset=utf-8", headers={"Content-Security-Policy": PAGE_POLICY}
    )


def settle(req: ApiRequest) -> Reply:
    outcome = req.params.get("outcome")
    if outcome not in ("paid", "failed", "cancelled"):
        raise not_found("route parameter")
    back = payments.mock_settle(_checkout_of(req), outcome)
    if back is None:
        raise not_found("payment")
    # res.redirect(303, back): the body Express writes for a client that takes text.
    return raw_reply(
        f"See Other. Redirecting to {back}".encode("utf8"),
        "text/plain; charset=utf-8",
        status=303,
        headers={"Location": back},
    )
