"""Consultation payments (Phase 10): gateway abstraction + fulfilment service.

    create_order -> client checkout -> verify (callback) | webhook (async)

See ``base.py`` for the provider interface, ``razorpay_gateway.py`` for the
only implementation today, and ``service.py`` for the DB-facing logic that
calls it.
"""
