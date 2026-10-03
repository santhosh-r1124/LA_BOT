import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handlers = {
  options: Record<string, unknown>;
  failed?: (response: { error?: { description?: string } }) => void;
};

/** A stand-in for Razorpay's checkout.js constructor that records options. */
function installFakeRazorpay(onOpen: (h: Handlers) => void) {
  const instances: Handlers[] = [];
  class FakeRazorpay {
    private handlers: Handlers;
    constructor(options: Record<string, unknown>) {
      this.handlers = { options };
      instances.push(this.handlers);
    }
    on(event: string, cb: Handlers['failed']) {
      if (event === 'payment.failed') this.handlers.failed = cb;
    }
    open() {
      onOpen(this.handlers);
    }
  }
  window.Razorpay = FakeRazorpay as unknown as NonNullable<Window['Razorpay']>;
  return instances;
}

const OPTIONS = {
  keyId: 'rzp_test_key',
  orderId: 'order_1',
  amountMinor: 150000,
  currency: 'INR',
  description: 'Vendor contract review',
  email: 'user@example.com',
};

beforeEach(() => {
  vi.resetModules();
  delete window.Razorpay;
  document.body.innerHTML = '';
});

afterEach(() => {
  delete window.Razorpay;
});

describe('openRazorpayCheckout', () => {
  it('passes the order to checkout and resolves with the handler payload', async () => {
    const instances = installFakeRazorpay((h) => {
      (h.options.handler as (r: unknown) => void)({
        razorpay_payment_id: 'pay_1',
        razorpay_order_id: 'order_1',
        razorpay_signature: 'sig',
      });
    });
    const { openRazorpayCheckout } = await import('./razorpay-checkout');
    await expect(openRazorpayCheckout(OPTIONS)).resolves.toEqual({
      razorpay_payment_id: 'pay_1',
      razorpay_order_id: 'order_1',
      razorpay_signature: 'sig',
    });
    expect(instances[0]?.options).toMatchObject({
      key: 'rzp_test_key',
      order_id: 'order_1',
      amount: 150000,
      currency: 'INR',
      prefill: { email: 'user@example.com' },
    });
  });

  it('rejects when the consumer closes the window', async () => {
    installFakeRazorpay((h) => {
      (h.options.modal as { ondismiss: () => void }).ondismiss();
    });
    const { openRazorpayCheckout } = await import('./razorpay-checkout');
    await expect(openRazorpayCheckout(OPTIONS)).rejects.toThrow(/closed/);
  });

  it('rejects with the gateway reason when the payment fails', async () => {
    installFakeRazorpay((h) => {
      h.failed?.({ error: { description: 'Card declined by bank' } });
    });
    const { openRazorpayCheckout } = await import('./razorpay-checkout');
    await expect(openRazorpayCheckout(OPTIONS)).rejects.toThrow('Card declined by bank');
  });

  it('loads checkout.js once and reports a load failure', async () => {
    const { openRazorpayCheckout } = await import('./razorpay-checkout');
    const pending = openRazorpayCheckout(OPTIONS);
    const scripts = document.querySelectorAll(
      'script[src="https://checkout.razorpay.com/v1/checkout.js"]',
    );
    expect(scripts).toHaveLength(1);
    scripts[0]?.dispatchEvent(new Event('error'));
    await expect(pending).rejects.toThrow(/Could not load the payment window/);
  });
});
