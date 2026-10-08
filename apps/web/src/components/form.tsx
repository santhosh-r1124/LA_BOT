'use client';

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type Ref,
  type SVGProps,
} from 'react';
import { AlertIcon, CheckIcon, EyeIcon, InfoIcon, SpinnerIcon } from '@/components/icons';

/**
 * Form primitives shared by the sign-in, sign-up, recovery and profile pages.
 * Styles come from the design system (packages/shared/src/styles) and use theme
 * tokens only, so everything follows the light and dark themes.
 *
 * What is here:
 * - `Field`: label, control, hint and inline error wired together with ids
 *   (`aria-describedby`, `aria-invalid`). Children can be a plain element (old
 *   call sites keep working), or a function that receives the ids to spread.
 * - `PasswordField`: a `Field` with a show/hide toggle.
 * - `LengthMeter`: "5 of 8 characters" bar for new passwords.
 * - `FormAlert` and `StatusAlert`: the form-level error and success messages.
 * - `SubmitButton`: loading state without ever disabling the focused control.
 * - `useFormFields` and `useErrorFocus`: values, touched/submitted bookkeeping,
 *   inline validation and focus management on error.
 */

export const inputClass = 'input';

export const buttonClass = 'btn btn-primary';

export const secondaryButtonClass = 'btn btn-secondary';

export type FieldErrors<K extends string = string> = Partial<Record<K, string>>;

/** Props a control inside a `Field` should receive. */
export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
}

export interface FieldProps {
  label: string;
  /** Guidance shown under the control (kept visible next to an error). */
  hint?: ReactNode;
  /** Inline error. Shown with an icon and `aria-invalid` on the control. */
  error?: string | null;
  /** Adds "(optional)" after the label. */
  optional?: boolean;
  /** Right-aligned content in the label row, such as "Forgot password?". */
  labelAction?: ReactNode;
  className?: string;
  children: ReactNode | ((control: FieldControlProps) => ReactNode);
}

export function Field({
  label,
  hint,
  error,
  optional,
  labelAction,
  className,
  children,
}: FieldProps) {
  const uid = useId();
  const id = `field-${uid}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;
  const control: FieldControlProps = {
    id,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : undefined,
  };

  let rendered: ReactNode;
  if (typeof children === 'function') {
    rendered = children(control);
  } else if (isValidElement(children)) {
    const props = children.props as Partial<FieldControlProps>;
    rendered = cloneElement(children as ReactElement<Partial<FieldControlProps>>, {
      id: props.id ?? control.id,
      'aria-describedby': props['aria-describedby'] ?? control['aria-describedby'],
      'aria-invalid': props['aria-invalid'] ?? control['aria-invalid'],
    });
  } else {
    rendered = children;
  }

  return (
    <div className={['field', className].filter(Boolean).join(' ')}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className={optional ? 'label label-optional' : 'label'}>
          {label}
        </label>
        {labelAction}
      </div>
      {rendered}
      {hint && (
        <div id={hintId} className="hint">
          {hint}
        </div>
      )}
      {error && (
        <p id={errorId} className="field-error">
          <AlertIcon className="mt-px h-4 w-4 flex-none" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

/** Eye with a slash. The shared icon set has the open eye only. */
function EyeOffIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      aria-hidden="true"
      {...props}
    >
      <path d="M10.6 5.1A9.6 9.6 0 0 1 12 5c5.2 0 8.6 4.1 9.7 6.1a1.7 1.7 0 0 1 0 1.8 14.5 14.5 0 0 1-2.9 3.4" />
      <path d="M6.6 6.7A14.7 14.7 0 0 0 2.3 11.9a1.7 1.7 0 0 0 0 1.8C3.4 15.7 6.8 19.8 12 19.8a9.8 9.8 0 0 0 4.4-1" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="m3.5 3.5 17 17" />
    </svg>
  );
}

export type PasswordFieldProps = Omit<FieldProps, 'children'> &
  Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'id' | 'children' | 'className'> & {
    inputRef?: Ref<HTMLInputElement>;
  };

/**
 * Password input with a show/hide button. The button is a real toggle
 * (`aria-pressed`), 40px square, and stays out of the way of the typed text.
 */
export function PasswordField({
  label,
  hint,
  error,
  optional,
  labelAction,
  inputRef,
  ...inputProps
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  return (
    <Field label={label} hint={hint} error={error} optional={optional} labelAction={labelAction}>
      {(control) => (
        <div className="relative">
          <input
            {...inputProps}
            {...control}
            ref={inputRef}
            type={visible ? 'text' : 'password'}
            className={`${inputClass} pr-12`}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? 'Hide password' : 'Show password'}
            aria-pressed={visible}
            className="btn btn-ghost btn-icon absolute inset-y-0 right-0 h-full w-11 rounded-l-none"
          >
            {visible ? <EyeOffIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
          </button>
        </div>
      )}
    </Field>
  );
}

/** "5 of 8 characters" with a bar; turns into a check when long enough. */
export function LengthMeter({ value, min = 8 }: { value: string; min?: number }) {
  const progress = Math.min(value.length / min, 1);
  const ok = value.length >= min;
  return (
    <div className="flex items-center gap-3 text-xs" data-testid="length-meter">
      <span
        aria-hidden="true"
        className="bg-line-strong h-1.5 flex-1 overflow-hidden rounded-pill"
      >
        <span
          className={`block h-full rounded-pill transition-[width] duration-200 ${
            ok ? 'bg-ok' : 'bg-accent'
          }`}
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </span>
      <span className={`flex items-center gap-1 whitespace-nowrap ${ok ? 'text-ok' : 'text-fg-muted'}`}>
        {ok && <CheckIcon className="h-3.5 w-3.5" />}
        {ok ? 'Long enough' : `${value.length} of ${min} characters`}
      </span>
    </div>
  );
}

type AlertTone = 'danger' | 'warn' | 'info' | 'ok';

/**
 * Form-level message. `role="alert"` announces it when it appears, and
 * `tabIndex={-1}` lets `useErrorFocus` move focus to it. Always icon + text.
 */
export function FormAlert({
  tone = 'danger',
  title,
  children,
  alertRef,
  className,
}: {
  tone?: AlertTone;
  title?: string;
  children?: ReactNode;
  alertRef?: Ref<HTMLDivElement>;
  className?: string;
}) {
  const Icon = tone === 'ok' ? CheckIcon : tone === 'info' ? InfoIcon : AlertIcon;
  return (
    <div
      ref={alertRef}
      role={tone === 'info' || tone === 'ok' ? 'status' : 'alert'}
      tabIndex={-1}
      data-form-alert=""
      className={['alert', `alert-${tone}`, 'outline-none', className].filter(Boolean).join(' ')}
    >
      <Icon />
      <div className="min-w-0">
        {title && <p className="alert-title">{title}</p>}
        {children && <div className={title ? 'mt-0.5' : undefined}>{children}</div>}
      </div>
    </div>
  );
}

/** Submit button with a loading state. It stays enabled (and focusable) while busy. */
export function SubmitButton({
  loading,
  loadingLabel,
  children,
  className,
}: {
  loading: boolean;
  loadingLabel?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="submit"
      aria-busy={loading ? true : undefined}
      className={['btn btn-primary btn-lg btn-block', className].filter(Boolean).join(' ')}
    >
      {loading && loadingLabel ? loadingLabel : children}
    </button>
  );
}

/** Centered spinner with text, for pending states that are not a button. */
export function PendingLine({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="text-fg-muted flex items-center justify-center gap-2 text-sm">
      <SpinnerIcon className="text-accent h-4 w-4" />
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Moves focus after a failed submit: the first control marked `aria-invalid`,
 * otherwise the form-level alert. Attach `rootRef` to the form and call
 * `requestFocus()` right after setting errors; it waits for the DOM to update.
 */
export function useErrorFocus<T extends HTMLElement = HTMLFormElement>() {
  const rootRef = useRef<T>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (tick === 0) return;
    const root = rootRef.current;
    if (!root) return;
    const target =
      root.querySelector<HTMLElement>('[aria-invalid="true"]') ??
      root.querySelector<HTMLElement>('[data-form-alert]');
    target?.focus();
  }, [tick]);

  const requestFocus = useCallback(() => setTick((t) => t + 1), []);
  return { rootRef, requestFocus };
}

type Touched<K extends string> = Partial<Record<K, boolean>>;

/**
 * Values plus inline validation for a form.
 *
 * - A client error shows once the field has been left (blur) or the form was
 *   submitted, then updates as the person types.
 * - A server error for a field shows until that field is edited.
 * - `bind(name)` gives a control its value, handlers and `aria-invalid`.
 */
export function useFormFields<K extends string>(
  initial: Record<K, string>,
  validate: (values: Record<K, string>) => FieldErrors<K>,
) {
  const [values, setValues] = useState<Record<K, string>>(initial);
  const [touched, setTouched] = useState<Touched<K>>({});
  const [submitted, setSubmitted] = useState(false);
  const [server, setServer] = useState<FieldErrors<K>>({});

  const client = validate(values);

  const errorFor = (name: K): string | undefined =>
    server[name] ?? (touched[name] || submitted ? client[name] : undefined);

  const set = (name: K, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    setServer((prev) => {
      if (!(name in prev)) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  const bind = (name: K) => ({
    name,
    value: values[name],
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => set(name, e.target.value),
    onBlur: () => setTouched((prev) => (prev[name] ? prev : { ...prev, [name]: true })),
  });

  /** Marks the form as submitted and returns the client errors (empty = valid). */
  const validateAll = (): FieldErrors<K> => {
    setSubmitted(true);
    setServer({});
    return client;
  };

  const setServerErrors = (fields: FieldErrors) => setServer(fields as FieldErrors<K>);

  const reset = (next: Record<K, string>) => {
    setValues(next);
    setTouched({});
    setSubmitted(false);
    setServer({});
  };

  return { values, set, bind, errorFor, validateAll, setServerErrors, reset };
}
