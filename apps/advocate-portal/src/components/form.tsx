'use client';

import { useId, useState, type ComponentProps, type ReactNode, type Ref } from 'react';
import { AlertIcon, CheckIcon, EyeIcon, InfoIcon } from '@/components/icons';
import { EyeOffIcon } from '@/components/portal-icons';
import type { Option } from '@/lib/options';
import styles from './form.module.css';

/**
 * Form primitives for the portal's pages. Visual styles come from the design
 * system (packages/shared/src/styles/design-system.css); these add the wiring
 * that makes a control accessible: a label tied to its input, hint and error
 * text announced with it, and `aria-invalid` while it has an error.
 */

export const inputClass = 'input';
export const buttonClass = 'btn btn-primary';
export const secondaryButtonClass = 'btn btn-secondary';

/** The attributes a control needs to be tied to its Field. */
export interface ControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
}

export function controlProps(
  id: string,
  { hint, error }: { hint?: ReactNode; error?: string },
): ControlProps {
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null]
    .filter(Boolean)
    .join(' ');
  return {
    id,
    'aria-describedby': describedBy || undefined,
    'aria-invalid': error ? true : undefined,
  };
}

/** The message under a field. The icon repeats what the words already say. */
export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="field-error">
      <AlertIcon className="mt-px size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/**
 * Label, control, hint and error. Give it an `id` and render the control with
 * the props it hands you:
 *
 *   <Field id="email" label="Email" error={errors.email}>
 *     {(c) => <input {...c} className="input" type="email" />}
 *   </Field>
 *
 * Without an `id` it falls back to wrapping the control in the label.
 */
export function Field({
  id,
  label,
  hint,
  error,
  optional,
  children,
}: {
  id?: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  optional?: boolean;
  children: ReactNode | ((control: ControlProps) => ReactNode);
}) {
  const labelClass = `label ${optional ? 'label-optional' : ''}`.trim();

  if (!id || typeof children !== 'function') {
    return (
      <label className="field">
        <span className={labelClass}>{label}</span>
        {typeof children === 'function' ? null : children}
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        {hint && !error && <span className="hint">{hint}</span>}
      </label>
    );
  }

  return (
    <div className="field">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {children(controlProps(id, { hint, error }))}
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
      {hint && (
        <div id={`${id}-hint`} className="hint">
          {hint}
        </div>
      )}
    </div>
  );
}

/** A password box with a show/hide button. */
export function PasswordInput({
  autoComplete,
  ...props
}: Omit<ComponentProps<'input'>, 'type'> & { autoComplete: 'current-password' | 'new-password' }) {
  const [shown, setShown] = useState(false);
  return (
    <div className={styles.passwordWrap}>
      <input
        {...props}
        type={shown ? 'text' : 'password'}
        autoComplete={autoComplete}
        className={`input ${styles.passwordInput}`}
      />
      <button
        type="button"
        className={`btn btn-ghost btn-icon ${styles.reveal}`}
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
        onClick={() => setShown((v) => !v)}
      >
        {shown ? <EyeOffIcon className="size-5" /> : <EyeIcon className="size-5" />}
      </button>
    </div>
  );
}

/** A live "8 or more characters" check that says met or not met in words. */
export function RuleCheck({ met, children }: { met: boolean; children: ReactNode }) {
  return (
    <div className={`${styles.rule} ${met ? styles.ruleMet : ''}`}>
      {met ? <CheckIcon /> : <InfoIcon />}
      <span>
        {children}
        <span className="sr-only">{met ? ': done' : ': not yet'}</span>
      </span>
    </div>
  );
}

/**
 * Choose any number of options from a short list, as toggle chips. The value is
 * the array of codes the API stores; labels are only for people.
 */
export function ChipGroup({
  id: idProp,
  legend,
  hint,
  error,
  options,
  value,
  onChange,
  describe,
}: {
  /** Set it to focus the group from outside (an error summary link). */
  id?: string;
  legend: string;
  hint?: ReactNode;
  error?: string;
  options: Option[];
  value: string[];
  onChange: (next: string[]) => void;
  /** The noun used in the count, e.g. "practice areas". */
  describe: string;
}) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const selected = new Set(value);

  function toggle(code: string) {
    onChange(selected.has(code) ? value.filter((v) => v !== code) : [...value, code]);
  }

  return (
    <fieldset
      id={id}
      tabIndex={-1}
      className={styles.chipField}
      aria-describedby={
        [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined
      }
    >
      <legend className="label">{legend}</legend>
      <div className={styles.chipBody}>
        <div className={styles.chips}>
          {options.map((option) => {
            const on = selected.has(option.value);
            return (
              <button
                key={option.value}
                type="button"
                className={`chip ${styles.chipButton}`}
                aria-pressed={on}
                onClick={() => toggle(option.value)}
              >
                {on && <CheckIcon />}
                {option.label}
              </button>
            );
          })}
        </div>
        <div className={styles.chipFoot}>
          <p className="hint" aria-live="polite">
            {value.length === 0 ? `No ${describe} chosen` : `${value.length} ${describe} chosen`}
          </p>
          {value.length > 0 && (
            <button type="button" className="btn-link text-xs" onClick={() => onChange([])}>
              Clear
              <span className="sr-only"> {describe}</span>
            </button>
          )}
        </div>
        {error && <FieldError id={errorId}>{error}</FieldError>}
        {hint && (
          <p id={hintId} className="hint">
            {hint}
          </p>
        )}
      </div>
    </fieldset>
  );
}

/** A tinted message for a whole form: a failed save, a success, a heads-up. */
export function FormMessage({
  tone,
  title,
  children,
  messageRef,
  live = 'assertive',
}: {
  tone: 'danger' | 'ok' | 'warn' | 'info';
  title: string;
  children?: ReactNode;
  messageRef?: Ref<HTMLDivElement>;
  live?: 'assertive' | 'polite' | 'off';
}) {
  const Icon = tone === 'ok' ? CheckIcon : tone === 'info' ? InfoIcon : AlertIcon;
  return (
    <div
      ref={messageRef}
      tabIndex={-1}
      role={live === 'assertive' ? 'alert' : live === 'polite' ? 'status' : undefined}
      className={`alert alert-${tone} ${styles.message}`}
    >
      <Icon />
      <div>
        <p className="alert-title">{title}</p>
        {children && <div className="mt-0.5">{children}</div>}
      </div>
    </div>
  );
}
