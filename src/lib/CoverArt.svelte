<script lang="ts">
  import { artUrl, coverFor, drawsFromDisk, imageUrl, type AlbumCover } from '$lib/artwork';

  /**
   * One album's artwork, resolved by the host.
   *
   * Every instance asks in the same tick, which `$lib/artwork` turns into one
   * batched call for the whole page. A missing or unreachable image is a blank
   * tile with a music note, never an error: the NIP is explicit that image URLs
   * rot and that a broken one is no reason to penalise anybody.
   *
   * `revision` is bumped by the page after a cover scan, which is what makes a
   * tile that answered "nothing known" ask again.
   */
  export let artist = '';
  export let album = '';
  export let preferThumb = false;
  export let size: 'small' | 'medium' | 'large' = 'small';
  export let revision = 0;

  let cover: AlbumCover | null = null;
  let src = '';
  /** The publisher's address, drawn only after a held copy would not decode. */
  let bypassLocal = false;
  let generation = 0;

  $: identity = `${artist}\u0000${album}\u0000${revision}`;
  $: {
    const current = ++generation;
    cover = null;
    src = '';
    bypassLocal = false;
    // Reading `identity` here is what subscribes this block to it.
    if (identity) {
      void coverFor(artist, album).then(async (found) => {
        if (current !== generation) return;
        cover = found;
        // The picture itself is read once and kept as a blob, so a tile that is
        // drawn again - after a view switch, or an idle spell long enough for the
        // browser to forget the image - does not re-open the file on disk.
        const url = await imageUrl(found, preferThumb);
        if (current === generation) src = url;
      });
    }
  }

  /**
   * A picture held on this computer can be evicted while a page is open, and the
   * directory can be emptied under a running window. The publisher's address is
   * the first fallback, a blank tile with a note is the last.
   */
  function onImageFailed() {
    if (cover && !bypassLocal && drawsFromDisk(cover, preferThumb)) {
      bypassLocal = true;
      src = artUrl(cover, preferThumb, false);
      return;
    }
    src = '';
  }
  // Art somebody signed and published reads differently from art only this
  // computer resolved, and the tooltip is the cheapest honest way to say so.
  $: origin = cover?.author
    ? `Cover ${cover.source ? `(${cover.source}) ` : ''}published to Deadwax`
    : 'Art resolved on this computer; not published';
</script>

{#if src}
  <span class="cover-art {size}" title={origin}>
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      onerror={onImageFailed}
    />
  </span>
{:else}
  <span class="cover-art {size} empty" aria-hidden="true">♪</span>
{/if}
