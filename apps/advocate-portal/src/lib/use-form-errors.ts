'use client';

import { useCallback, useMemo, useState } from 'react';
import { validateFields, type FieldErrors, type FormValues, type RegisterField } from './forms';

/**
 * Field errors for a form: a message shows once its field has been left (or the
 * form was submitted), and a message from the server shows until the person
 * edits that field. Validation itself lives in ./forms.
 */
export function useFormErrors<F extends RegisterField>(fields: readonly F[], values: FormValues) {
  const [touched, setTouched] = useState<Partial<Record<F, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [server, setServer] = useState<FieldErrors<F>>({});

  const client = useMemo(() => validateFields(fields, values), [fields, values]);

  const errorFor = useCallback(
    (field: F): string | undefined =>
      server[field] ?? (touched[field] || submitted ? client[field] : undefined),
    [server, touched, submitted, client],
  );

  const touch = useCallback((field: F) => {
    setTouched((t) => (t[field] ? t : { ...t, [field]: true }));
  }, []);

  /** Call when a field's value changes: its server message is out of date. */
  const clearServer = useCallback((field: F) => {
    setServer((s) => {
      if (s[field] === undefined) return s;
      const next = { ...s };
      delete next[field];
      return next;
    });
  }, []);

  /** Marks the form submitted (so every message shows) and returns what is wrong now. */
  const submit = useCallback((): FieldErrors<F> => {
    setSubmitted(true);
    setServer({});
    return client;
  }, [client]);

  return { client, errorFor, touch, clearServer, submit, setServer };
}
