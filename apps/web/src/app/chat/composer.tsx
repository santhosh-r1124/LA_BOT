'use client';

import { useLayoutEffect, type FormEvent, type KeyboardEvent, type RefObject } from 'react';
import { AlertIcon } from '@/components/icons';
import { MAX_QUESTION_LENGTH } from './chat-helpers';
import { SendIcon, StopIcon } from './chat-icons';
import styles from './chat.module.css';

const MAX_HEIGHT_PX = 192;

/**
 * The question box: grows with the text, Enter sends, Shift+Enter adds a line,
 * Esc stops a running reply. Sending an empty box shows a hint instead of
 * silently doing nothing.
 */
export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  sending,
  showEmptyHint,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  sending: boolean;
  showEmptyHint: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const canSend = value.trim().length > 0;

  // Auto-grow: reset to auto so it can also shrink, then fit the content.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [value, inputRef]);

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape' && sending) {
      e.preventDefault();
      onStop();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSend();
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    onSend();
  }

  const nearLimit = value.length >= MAX_QUESTION_LENGTH - 800;

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="composer">
        <label htmlFor="chat-input" className="sr-only">
          Ask a legal question
        </label>
        <textarea
          id="chat-input"
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          maxLength={MAX_QUESTION_LENGTH}
          enterKeyHint="send"
          autoComplete="off"
          placeholder="Ask about Indian law…"
          aria-describedby="composer-hint"
          aria-invalid={showEmptyHint || undefined}
          className="text-[1rem]"
        />
        {sending ? (
          <button type="button" className="btn btn-secondary" onClick={onStop} aria-label="Stop the reply">
            <StopIcon />
            Stop
          </button>
        ) : (
          <button
            type="submit"
            className={`btn btn-primary ${styles.sendBtn} ${canSend ? '' : styles.sendBtnIdle}`}
            aria-disabled={!canSend}
            aria-label="Send question"
          >
            <SendIcon />
            <span className={styles.sendLabel}>Send</span>
          </button>
        )}
      </div>

      <div className={styles.composerMeta}>
        <p id="composer-hint" className={styles.composerHint}>
          {showEmptyHint ? (
            <span className={styles.emptyHint} role="status">
              <AlertIcon />
              Write your question first.
            </span>
          ) : sending ? (
            <span className={styles.hintLine}>
              Working on it.
              <span className={styles.keyHint}>
                {' '}
                Press <kbd className="kbd">Esc</kbd> to stop.
              </span>
            </span>
          ) : (
            <span className={`${styles.hintLine} ${styles.keyHint}`}>
              <kbd className="kbd">Enter</kbd> to send &middot; <kbd className="kbd">Shift</kbd>
              {' + '}
              <kbd className="kbd">Enter</kbd> for a new line
            </span>
          )}
        </p>
        {nearLimit && (
          <span className={`${styles.hintLine} ${styles.counter} ${styles.counterNear}`} aria-live="polite">
            {value.length.toLocaleString('en-IN')} / {MAX_QUESTION_LENGTH.toLocaleString('en-IN')}
          </span>
        )}
      </div>
    </form>
  );
}
