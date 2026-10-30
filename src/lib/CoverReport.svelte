<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { coverReportReasons, type CoverReportReason } from '$lib/artwork';

  /**
   * Report a published cover as a NIP-56 kind `1984`.
   *
   * The reasons are the protocol's own list, and they are the same words the
   * phone offers — a report is a public statement about somebody's work, so
   * both apps must describe the same complaint the same way. Only the album key
   * travels: which claim to report, and who wrote it, is the host's decision,
   * because the host is what knows which claim actually wins.
   */
  export let albumKey = '';
  export let label = '';
  export let onClose: () => void = () => {};
  export let onReported: (message: string) => void = () => {};

  let reason: CoverReportReason = 'spam';
  let note = '';
  let busy = false;
  let error = '';

  async function send() {
    if (busy || !albumKey) return;
    busy = true;
    error = '';
    try {
      const reportId = await invoke<string>('report_cover', {
        key: albumKey,
        reason,
        note: note.trim()
      });
      onReported(
        reportId ? `Cover report published as ${reportId.slice(0, 12)}…` : 'Cover report sent'
      );
      onClose();
    } catch (failure) {
      error = String(failure);
    } finally {
      busy = false;
    }
  }
</script>

<div
  class="cover-report-backdrop"
  role="presentation"
  onclick={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}
>
  <div class="cover-report" role="dialog" aria-modal="true" aria-label="Report a cover">
    <header class="cover-report-head">
      <div>
        <b>Report this cover</b>
        <small>{label}</small>
        <code>{albumKey}</code>
      </div>
      <button class="classic-button" onclick={onClose}>Cancel</button>
    </header>

    <p class="cover-report-hint">
      This is public and signed with your own identity. It tells other clients which cover to
      distrust; it does not replace the cover. To put better art in its place, use
      <em>Fix album art…</em> instead.
    </p>

    <div class="cover-report-reasons" role="radiogroup" aria-label="Report reason">
      {#each coverReportReasons as option (option.value)}
        <button
          type="button"
          class="cover-report-reason"
          class:chosen={reason === option.value}
          role="radio"
          aria-checked={reason === option.value}
          onclick={() => (reason = option.value)}
        >
          <span>{option.label}</span>
          {#if reason === option.value}<small>Chosen</small>{/if}
        </button>
      {/each}
    </div>

    <label class="cover-report-note">
      <span>Anything to add? (optional, up to 500 characters)</span>
      <textarea
        bind:value={note}
        rows="3"
        maxlength="500"
        placeholder="Say what is wrong with this cover"
      ></textarea>
    </label>

    {#if error}<div class="cover-report-error">{error}</div>{/if}

    <div class="cover-report-actions">
      <button class="classic-button primary" onclick={() => void send()} disabled={busy || !albumKey}>
        {busy ? 'Sending…' : 'Send report'}
      </button>
    </div>
  </div>
</div>

<style>
  .cover-report-backdrop {
    position: fixed;
    inset: 0;
    background: var(--scrim);
    display: grid;
    place-items: center;
    z-index: 200;
    padding: 24px;
  }
  .cover-report {
    width: min(520px, 100%);
    max-height: min(760px, 88vh);
    overflow: auto;
    background: var(--panel-raised);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 14px 16px 18px;
    color: var(--text);
    font-size: 13px;
  }
  .cover-report-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }
  .cover-report-head b {
    display: block;
    font-size: 15px;
  }
  .cover-report-head small {
    display: block;
    color: var(--muted);
    margin: 2px 0;
  }
  .cover-report-head code {
    color: var(--dim);
    font-size: 11px;
  }
  .cover-report-hint {
    color: var(--muted);
    font-size: 12px;
    margin: 10px 0 0;
  }
  .cover-report-hint em {
    color: var(--text);
    font-style: normal;
  }
  .cover-report-reasons {
    display: grid;
    gap: 6px;
    margin-top: 12px;
  }
  .cover-report-reason {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    width: 100%;
    text-align: left;
    background: var(--sunken);
    border: 1px solid var(--line);
    border-radius: 7px;
    color: var(--text);
    padding: 9px 11px;
    cursor: pointer;
  }
  .cover-report-reason.chosen {
    border-color: var(--dim);
    background: var(--accent-soft);
  }
  .cover-report-reason small {
    color: var(--dim);
    font-size: 11px;
  }
  .cover-report-note {
    display: block;
    margin-top: 12px;
  }
  .cover-report-note span {
    display: block;
    color: var(--muted);
    font-size: 12px;
    margin-bottom: 5px;
  }
  .cover-report-note textarea {
    width: 100%;
    box-sizing: border-box;
    background: var(--sunken);
    border: 1px solid var(--line);
    border-radius: 6px;
    color: var(--text);
    padding: 8px 9px;
    font: inherit;
    resize: vertical;
  }
  .cover-report-error {
    margin-top: 10px;
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 12px;
    background: var(--danger-soft);
    border: 1px solid var(--danger-line);
    color: var(--danger);
  }
  .cover-report-actions {
    margin-top: 14px;
    display: flex;
    justify-content: flex-end;
  }
</style>
