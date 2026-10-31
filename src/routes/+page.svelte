<script lang="ts">
  import { t, locale, message as msg, initializeLocale, type Message } from '@napstr/i18n/svelte';
  import LanguageSelect from '@napstr/i18n/LanguageSelect.svelte';
  import { readStoredPreference } from '@napstr/i18n';
  import { locale as osLocale } from '@tauri-apps/plugin-os';
  import '@napstr/i18n/styles.css';
  import { onMount, tick } from 'svelte';
  import { getVersion } from '@tauri-apps/api/app';
  import { invoke } from '@tauri-apps/api/core';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { open, save } from '@tauri-apps/plugin-dialog';
  import CoverArt from '$lib/CoverArt.svelte';
  import CoverPicker from '$lib/CoverPicker.svelte';
  import CoverReport from '$lib/CoverReport.svelte';
  import { albumsFor, artUrl, clearCoverCache, coverFor, coverKey, type CoverAlbum } from '$lib/artwork';

  let appVersion = '…';
  const SEARCH_PAGE_SIZE = 100;
  const LOCAL_PAGE_SIZE = 100;
  const CHAT_PAGE_SIZE = 100;
  const VISIBLE_SEEDER_LIMIT = 100;

  type View = 'Search' | 'Network' | 'Downloads' | 'Shared' | 'Playlists' | 'Profile' | 'Settings' | 'Trollbox' | 'Clients' | 'Covers';

  /** One count with the thing counted beside it, as the host sends it. */
  type CatalogueCount = { label: string; count: number };
  /** The figures behind the Network page (`catalogue::NetworkStats`). */
  type CatalogueStats = {
    announced: number;
    indexed: number;
    publishers: number;
    liveFiles: number;
    livePeers: number;
    describedLive: number;
    held: number;
    lastWrite: string;
    formats: CatalogueCount[];
    artists: CatalogueCount[];
    publishersTop: { pubkey: string; announced: number; live: number }[];
  };
  type PlayerMode = 'single' | 'folder' | 'all';
  type PlayerOrigin = 'search' | 'downloads' | 'shared' | 'audiobook' | 'direct';
  /** Repeat, as the phone offers it and this window now plays it. */
  type RemoteRepeat = 'off' | 'all' | 'one';
  /**
   * A transport instruction a phone sent, forwarded by the playback bridge.
   * Commands the native player carries out on its own - pause, seek and volume -
   * never reach the window, so only these arrive here. `stop` does arrive, even
   * though the player stops on its own: the window has to know that the track it
   * was showing is no longer loaded, or its own play button would ask a player
   * that holds nothing.
   */
  type RemotePlaybackCommand =
    | { type: 'play' }
    | { type: 'toggle' }
    | { type: 'next' }
    | { type: 'previous' }
    | { type: 'volume'; percent: number }
    | { type: 'repeat'; mode: RemoteRepeat }
    | { type: 'shuffle'; enabled: boolean }
    | { type: 'stop' }
    | { type: 'handoff' }
    | { type: 'playTrack'; fileId: string; queue: string[]; positionMs: number };
  type WindowResizeDirection = 'East' | 'North' | 'NorthEast' | 'NorthWest' | 'South' | 'SouthEast' | 'SouthWest' | 'West';
  type Result = {
    id: number;
    name: string;
    format: string;
    size: string;
    sources: number;
    speed: string;
    length: string;
    fileId: string;
    sourceDetails?: SourceDetail[];
    remote?: boolean;
    artist?: string;
    album?: string;
    license?: string;
    description?: string;
    tags?: string;
    audiobook?: Audiobook;
    /** Known only where this computer read the file itself. */
    bitrateKbps?: number;
  };
  type CatalogueUser = { pubkey: string; npub: string; displayName: string };
  type SourceDetail = { pubkey: string; npub: string; displayName: string; relay: string; about: string; picture: string; eventId: string };
  type Transfer = {
    id: number;
    fileId: string;
    name: string;
    size: string;
    speed: string;
    progress: number;
    status: string;
    destination: string;
  };

  const views: { label: View; icon: string }[] = [
    { label: 'Search', icon: '⌕' },
    { label: 'Network', icon: '▦' },
    { label: 'Downloads', icon: '⇩' },
    { label: 'Shared', icon: '▤' },
    { label: 'Playlists', icon: '♫' },
    { label: 'Profile', icon: '☺' },
    { label: 'Settings', icon: '⚙' },
    { label: 'Trollbox', icon: '▣' },
    { label: 'Clients', icon: '▯' },
    { label: 'Covers', icon: '▨' }
  ];

  /**
   * One 24×24 stroked path per view.
   *
   * The rail used to be text glyphs, and a glyph is drawn by whichever font
   * happens to have it: `⌕` came out as a circle with a slash, and the ten
   * icons were not even the same size. A path is the same shape everywhere.
   */
  const viewIcons: Record<View, string> = {
    Search: 'M11 4.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM15.9 15.9 20.5 20.5',
    Network: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM4.4 12h15.2M12 4c2.4 2.2 3.7 5 3.7 8s-1.3 5.8-3.7 8c-2.4-2.2-3.7-5-3.7-8s1.3-5.8 3.7-8z',
    Downloads: 'M12 4v10M8 11.2l4 4 4-4M4.5 19.5h15',
    Shared: 'M4 8.2 12 4l8 4.2-8 4.2-8-4.2zM4 12.4l8 4.2 8-4.2M4 16.6l8 4.2 8-4.2',
    Playlists: 'M4 7h11M4 12h11M4 17h7M16 12.6l4.4 2.6-4.4 2.6z',
    Profile: 'M12 4.4a3.6 3.6 0 1 1 0 7.2 3.6 3.6 0 0 1 0-7.2zM4.8 20c1.2-3.6 3.9-5.4 7.2-5.4s6 1.8 7.2 5.4',
    Settings: 'M12 8.6a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8zM12 3.6V6M12 18v2.4M3.6 12H6M18 12h2.4M6.1 6.1l1.7 1.7M16.2 16.2l1.7 1.7M17.9 6.1l-1.7 1.7M7.8 16.2l-1.7 1.7',
    Trollbox: 'M4.5 6h15v9.6H9.4L4.5 19V6z',
    Clients: 'M9.2 3h5.6v18H9.2zM12 18.2h.01',
    Covers: 'M4 4h6.6v6.6H4zM13.4 4H20v6.6h-6.6zM4 13.4h6.6V20H4zM13.4 13.4H20V20h-6.6z'
  };
  const aboutIcon = 'M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16zM9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.5M12 17h.01';
  const railChevron = { open: 'M15 5.5 8.5 12l6.5 6.5', closed: 'M9 5.5 15.5 12 9 18.5' };

  type NativeFile = { fileId: string; filename: string; path: string; folder: string; size: number; format: string; status: string; title: string; artist: string; album: string; mime: string; license: string; description: string; tags: string; bitrateKbps?: number };
  type NativeTransfer = { id: number; fileId: string; filename: string; size: number; progress: number; status: string; speed: string; destination: string };
  type NativeSettings = { napstrFolder: string; nostrRelays: string; displayName: string; profileAbout: string; profilePicture: string };
  type AudiobookChapter = { position: number; fileId: string; filename: string; title: string; format: string; mime: string; size: number };
  type Audiobook = { audiobookId: string; title: string; author: string; narrator: string; totalSize: number; chapters: AudiobookChapter[]; sources: SourceDetail[]; local: boolean; localFolder: string };
  type Snapshot = { files: NativeFile[]; audiobooks: Audiobook[]; transfers: NativeTransfer[]; settings: NativeSettings; indexedBytes: number; native: boolean };
  type NetworkStatus = { connected: boolean; npub: string; pubkey: string; relayCount: number; torRunning: boolean; torStarting: boolean; torProgress: number; torError: string; error: string };
  type NetworkResult = { fileId: string; filename: string; title: string; artist: string; album: string; format: string; mime: string; size: number; license: string; description: string; tags: string; sources: SourceDetail[] };
  type CatalogueBrowseCursor = { sessionId: string };
  type CatalogueBrowsePage = { results: NetworkResult[]; cursor: CatalogueBrowseCursor | null; totalAvailable: number };
  type PlayerTrack = { fileId: string; name: string; folder: string; artist: string; mime: string };
  type PlaybackStatus = { fileId: string; currentTime: number; duration: number; playing: boolean; ended: boolean; error: string; volume: number };
  type ReleaseStatus = { version: string; url: string };
  type GitHubRelease = { tag_name?: unknown; html_url?: unknown };
  type TrollboxMessage = { eventId: string; pubkey: string; npub: string; displayName: string; content: string; createdAt: number };
  /** What the conversation around a file looks like to a row that shows it. */
  type TrackDiscussionActivity = { fileId: string; authors: number; messages: number; lastAt: number };
  type IndexProgress = { scanning: boolean; processedFiles: number; indexedFiles: number; message: string };
  type IndexBatch = { files: NativeFile[]; fileCount: number; totalBytes: number };
  type DeviceRights = { browse: boolean; fetch: boolean; control: boolean; download: boolean; privileged: boolean };
  type MobileDevice = { endpointId: string; name: string; pairedAt: string; lastSeen: string; rights: DeviceRights; pubkey: string; likes: number; dislikes: number; playlists: number };
  type MobileStatus = { running: boolean; online: boolean; endpointId: string; error: string; devices: MobileDevice[] };
  type MobilePairingOffer = { ticket: string; qrSvg: string; expiresAt: number; endpointId: string };
  type BlockConfirmation =
    | { kind: 'file'; fileId: string; label: string }
    | { kind: 'user'; pubkey: string; label: string };
  /** A playlist as the Playlists page lists it: no members, which is what makes
   *  browsing cheap. `author` is half the coordinate, so it travels with every
   *  row. */
  type PlaylistSummary = {
    playlistId: string;
    title: string;
    author: string;
    displayName: string;
    image: string;
    trackCount: number;
    private: boolean;
    published: boolean;
    updatedAt: number;
  };
  /** One member, in the order the playlist puts it in. */
  type PlaylistMember = {
    position: number;
    fileId: string;
    title: string;
    artist: string;
    album: string;
  };
  /** A playlist and all of its members, which is what the editor edits. */
  type PlaylistDetail = {
    playlistId: string;
    title: string;
    author: string;
    displayName: string;
    artist: string;
    mbid: string;
    image: string;
    tags: string;
    private: boolean;
    published: boolean;
    updatedAt: number;
    tracks: PlaylistMember[];
    total: number;
  };
  /**
   * A track the editor may add as a member.
   *
   * `source` says where the row was found, not what the file is. A playlist may
   * name files its author does not hold — that is curation, and the common case
   * is building a list of things you have not listened to yet — so the picker
   * searches this computer and the network, and marks what is not here yet.
   */
  type PlaylistCandidate = {
    fileId: string;
    title: string;
    artist: string;
    album: string;
    filename: string;
    source: 'local' | 'network';
  };
  /** What one look at the relays answered, as the host reports it. */
  type PlaylistReadReport = {
    stored: number;
    withdrawn: number;
    /** This identity's own live coordinates on the relays, held here or not. */
    own: PlaylistSummary[];
  };
  /** How many live seeders one member of an open playlist has right now. */
  type PlaylistMemberAvailability = { fileId: string; seeders: number };
  /**
   * Where a row of the list came from, which is what its badge says.
   *
   * `held` is a playlist this computer holds and the relays know, `relays` one
   * the relays know and this computer does not (so it can be restored), `local`
   * one the relays have seen and no longer answer with (withdrawable), `draft`
   * one nobody outside this computer has ever seen, and `theirs` somebody
   * else's public playlist, which is read-only here.
   */
  type PlaylistRowState = 'held' | 'relays' | 'local' | 'draft' | 'theirs';
  type PlaylistRow = PlaylistSummary & { state: PlaylistRowState; withdrawable: boolean };

  let activeView: View = 'Search';
  /**
   * Whether the rail shows its labels. The icons alone are the default because a
   * window this size (1180 wide by default) has more use for the width, and the
   * choice is remembered per machine rather than per window.
   */
  let railExpanded = false;
  function toggleRail() {
    railExpanded = !railExpanded;
    try { window.localStorage.setItem('deadwax-rail', railExpanded ? '1' : '0'); } catch { /* a blocked store is not a reason to fail */ }
  }
  /**
   * Which skin the window draws with.
   *
   * `app.html` sets it before the first paint from the same key, so the only job
   * here is to keep the two in step when a person presses the toggle.
   */
  let theme: 'dark' | 'light' = 'dark';
  function applyTheme(next: 'dark' | 'light', remember: boolean) {
    theme = next;
    document.documentElement.dataset.theme = next;
    if (!remember) return;
    try { window.localStorage.setItem('deadwax-theme', next); } catch { /* a blocked store leaves this session's choice */ }
  }
  function toggleTheme() { applyTheme(theme === 'light' ? 'dark' : 'light', true); }
  /** The album the player's art belongs to, for a track that came from the queue. */
  let playerAlbum = '';
  $: playerAlbum = currentTrack ? sharedFiles.find((file) => file.fileId === currentTrack!.fileId)?.album ?? '' : '';

  /**
   * What the box offers while somebody types.
   *
   * The host answers from the catalogue it has mirrored and from this computer's
   * own library, so the list is the network's own vocabulary rather than a guess.
   * Nothing is asked for until a pause, because a suggestion is never worth a
   * request per keystroke.
   */
  let searchSuggestions: string[] = [];
  let suggestionTimer: ReturnType<typeof setTimeout> | null = null;
  function queueSuggestions(prefix: string) {
    if (suggestionTimer) clearTimeout(suggestionTimer);
    const wanted = prefix.trim();
    if (!wanted) { searchSuggestions = []; return; }
    suggestionTimer = setTimeout(() => {
      void invoke<string[]>('search_suggestions', { prefix: wanted })
        .then((words) => { if (query.trim() === wanted) searchSuggestions = Array.isArray(words) ? words : []; })
        .catch(() => { /* a suggestion that does not arrive is not an error */ });
    }, 180);
  }
  $: queueSuggestions(query);
  let results: Result[] = [];
  let resultPage = 0;
  let query = '';
  let searchUser: CatalogueUser | null = null;
  let resultUser: CatalogueUser | null = null;
  let matchingUsers: CatalogueUser[] = [];
  let format = 'Audio only';
  let minimumSources = 1;
  let maximumSize = '';
  let searchedQuery = 'All audio';
  let resultsAreNetwork = false;
  let selected: Result | null = null;
  let selectedResultIds = new Set<string>();
  let resultSelectionAnchor: string | null = null;
  let downloadingSelection = false;
  let clearingTransfers = false;
  let removingTransfers = new Set<number>();
  let downloadGeneration = 0;
  let nextOptimisticTransferId = Date.now();
  let downloadLibraryRefreshNeeded = false;
  const pendingDownloadRequests = new Map<Promise<unknown>, string>();
  const downloadAttempts = new Map<string, { cancelled: boolean }>();
  const cancellingFiles = new Set<string>();
  let advanced = false;
  let paused = false;
  let aboutOpen = false;
  let sourceProfile: SourceDetail | null = null;
  let blockConfirmation: BlockConfirmation | null = null;
  let blockInProgress = false;
  let startingDownloads = new Set<string>();
  // Format the clock in the template: a legacy $: declaration here changes
  // dependency tracking for the entire component and freezes helper-based views.
  let clockNow = Date.now();
  let desktopRuntime = false;
  let nativeReady = false;
  let activityMessage: string | Message = msg("Starting Deadwax…");
  let napstrFolder = '';
  let nostrRelays = 'wss://relay.damus.io, wss://nos.lol, wss://relay.nostr.com, wss://relay.primal.net, wss://relay.snort.social, wss://nostr.mom, wss://relay.nostr.band';
  let displayName = 'napstr-user';
  let profileAbout = 'Sharing files privately with Deadwax. deadwax.rip';
  let profilePicture = '';
  let indexedBytes = 0;
  let networkConnected = false;
  let torRunning = false;
  let torStarting = false;
  let torProgress = 0;
  let torError = '';
  let identityNpub = '';
  let networkError = '';
  let networkConnectPending = false;
  let newRelease: ReleaseStatus | null = null;
  let trollboxMessages: TrollboxMessage[] = [];
  let trollboxDraft = '';
  let trollboxLoading = false;
  let trollboxSending = false;
  let trollboxError: string | Message = '';
  let trollboxPollPending = false;
  let trollboxRefreshAgain = false;
  let trollboxHasMore = true;
  let mobileStatusValue: MobileStatus | null = null;
  let clientNote = '';
  let catalogueStats: CatalogueStats | null = null;
  let catalogueStatsPending = false;
  let catalogueStatsError: string | Message = '';
  /** One page of the peers behind the catalogue, and where the pager is. */
  type SeederRow = { pubkey: string; npub: string; name: string; announced: number; live: number };
  type SeederPage = { rows: SeederRow[]; total: number };
  const SEEDER_PAGE_SIZE = 12;
  let seedersPage: SeederPage = { rows: [], total: 0 };
  let seederPageIndex = 0;
  let seedersPending = false;
  let seederError = '';
  let showQuietSeeders = false;
  let mobileStreamPairing: MobilePairingOffer | null = null;
  let mobileLoading = false;
  let mobileStatusPending = false;
  let mobileError: string | Message = '';
  let trollboxLog: HTMLDivElement;
  let trackDiscussionFileId = '';
  let trackDiscussionMessages: TrollboxMessage[] = [];
  let trackDiscussionDraft = '';
  let trackDiscussionLoading = false;
  let trackDiscussionSending = false;
  let trackDiscussionError = '';
  let trackDiscussionPollPending = false;
  let trackDiscussionRefreshAgain = false;
  let trackDiscussionSubscribeAgain = false;
  let trackDiscussionHasMore = true;
  let trackDiscussionGeneration = 0;
  let trackDiscussionLog: HTMLDivElement;
  /**
   * What the conversation looks like from a row, by file id.
   *
   * A row is not the place to read a discussion - that is what the panel beside
   * it is for - so all this carries is whether anyone has had anything to say at
   * all, and how many people that was.
   */
  let discussionActivity: Record<string, TrackDiscussionActivity> = {};
  /** Files already asked about, so scrolling past them costs nothing. */
  const discussionAsked = new Set<string>();
  let searchAction: 'search' | 'surprise' | null = null;
  let browseCursor: CatalogueBrowseCursor | null = null;
  let browseLoading = false;
  let browseGeneration = 0;
  let loadedNetworkMatches: NetworkResult[] = [];
  let loadedNetworkAudiobooks: Audiobook[] = [];
  let browseTotalAvailable = 0;
  let rescanPending = false;
  let indexing = false;
  let selectedShared: NativeFile | null = null;
  let sharedLibraryPage = 0;
  let selectedSource = 0;
  let selectedTagFile: NativeFile | null = null;
  let tagDraft = '';
  let tagSaving = false;
  let libraryFolderView = '*';
  let libraryFolderMenuOpen = false;
  let playerMode: PlayerMode = 'single';
  let playerOrigin: PlayerOrigin = 'direct';
  let activePlayerAudiobook: Audiobook | null = null;
  let playerQueue: PlayerTrack[] = [];
  let playerQueueIndex = -1;
  /**
   * The queue in the order it was chosen, so shuffle can be undone. Kept apart
   * from `playerQueue` because a shuffled queue is the same tracks in another
   * order, not a different queue.
   */
  let playerQueueOrder: PlayerTrack[] = [];
  /** True while the queue came from a phone rather than from this window. */
  let playerQueueRemote = false;
  let playerRepeat: RemoteRepeat = 'off';
  let playerShuffle = false;
  /** What the bridge was last told, so a change is the only thing that is sent. */
  let publishedQueueFacts = '';
  let queueFacts: {
    len: number;
    index: number;
    fileIds: string[];
    repeat: RemoteRepeat;
    shuffle: boolean;
  } = {
    len: 0,
    index: -1,
    fileIds: [],
    repeat: 'off',
    shuffle: false
  };
  let currentTrack: PlayerTrack | null = null;
  let playerPlaying = false;
  let playerLoading = false;
  let playerCurrentTime = 0;
  let playerDuration = 0;
  let playerVolume = 0.85;
  /** When this window last told the player what volume to use. */
  let volumeSentAt = 0;
  let pushedPlayerVolume = false;
  let playerEnded = false;
  let lastPlayerError = '';
  let transfers: Transfer[] = [];
  let localAudiobooks: Audiobook[] = [];
  let audiobookEditorOpen = false;
  let audiobookSaving = false;
  let audiobookTitle = '';
  let audiobookAuthor = '';
  let audiobookNarrator = '';
  type AudiobookDownload = { audiobookId: string; title: string; author: string; narrator: string; destinationFolder: string; chapters: AudiobookChapter[]; sources: SourceDetail[]; nextIndex: number; activeFileId: string; failed: number };
  let audiobookDownloads: AudiobookDownload[] = [];

  let sharedFiles: Array<NativeFile & { name: string; readableSize: string; peers: number }> = [];
  let localFileIds = new Set<string>();

  const readableSize = (bytes: number) => {
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
    if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(bytes >= 100 * 1024 ** 2 ? 0 : 1)} MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${bytes} B`;
  };

  function mapFiles(files: NativeFile[]): Result[] {
    return files.map((file, index) => ({
      id: index + 1, name: file.title || file.filename, format: file.format, size: readableSize(file.size), sources: 1,
      speed: 'Local', length: '—', fileId: file.fileId, artist: file.artist, album: file.album, license: file.license, description: file.description, tags: file.tags,
      bitrateKbps: file.bitrateKbps ?? 0
    }));
  }

  function mapNetworkFiles(files: NetworkResult[]): Result[] {
    return files.map((file, index) => {
      const local = localFileIds.has(file.fileId);
      return {
        id: index + 1, name: file.title || file.filename, format: file.format, size: readableSize(file.size),
        sources: file.sources.length, speed: local ? 'Local' : 'Tor', length: '—', fileId: file.fileId,
        sourceDetails: file.sources, remote: !local, artist: file.artist, album: file.album,
        license: file.license, description: file.description, tags: file.tags
      };
    });
  }

  function audiobookMatches(book: Audiobook, value: string) {
    if (/^audiobooks?$/i.test(value.trim())) return true;
    const fields = [book.title, book.author, book.narrator, ...book.chapters.flatMap((chapter) => [chapter.title, chapter.filename])]
      .join(' ')
      .toLowerCase();
    return value.trim().toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).every((token) => fields.includes(token));
  }

  function mergeAudiobooks(trackResults: Result[], remoteBooks: Audiobook[], searchValue: string) {
    const audiobookKeyword = /^audiobooks?$/i.test(searchValue.trim());
    if (format !== 'Audiobooks' && !audiobookKeyword) return trackResults;
    const books = new Map<string, Audiobook>();
    for (const incoming of [...localAudiobooks.filter((book) => audiobookMatches(book, searchValue)), ...remoteBooks]) {
      const existing = books.get(incoming.audiobookId);
      if (!existing) {
        books.set(incoming.audiobookId, { ...incoming, sources: [...incoming.sources] });
        continue;
      }
      const sources = new Map(existing.sources.map((source) => [source.pubkey, source]));
      incoming.sources.forEach((source) => sources.set(source.pubkey, source));
      books.set(incoming.audiobookId, {
        ...(existing.local ? existing : incoming),
        local: existing.local || incoming.local,
        localFolder: existing.localFolder || incoming.localFolder,
        sources: [...sources.values()]
      });
    }
    const grouped = [...books.values()].map((book, index): Result => ({
      id: -(index + 1),
      name: book.title,
      format: 'AUDIOBOOK',
      size: readableSize(book.totalSize),
      sources: Math.max(book.local ? 1 : 0, book.sources.length),
      speed: book.local ? 'Local' : 'Tor',
      length: `${book.chapters.length} chapters`,
      fileId: `audiobook:${book.audiobookId}`,
      artist: book.author,
      album: book.narrator ? `Narrated by ${book.narrator}` : '',
      remote: !book.local,
      sourceDetails: book.sources,
      audiobook: book
    }));
    if (format === 'Audiobooks') {
      return grouped
        .sort((left, right) => right.sources - left.sources || left.name.localeCompare(right.name))
        .map((result, index) => ({ ...result, id: index + 1 }));
    }
    // The dedicated media browse presents each collection once. This is only
    // a display filter: normal title/artist searches retain every underlying
    // audio hash, so one publisher cannot hide ordinary tracks by grouping
    // them into a bogus collection.
    const chapterIds = audiobookKeyword
      ? new Set([...books.values()].flatMap((book) => book.chapters.map((chapter) => chapter.fileId)))
      : null;
    const displayedTracks = chapterIds
      ? trackResults.filter((track) => !chapterIds.has(track.fileId))
      : trackResults;
    return [...grouped, ...displayedTracks]
      .sort((left, right) => right.sources - left.sources || left.name.localeCompare(right.name))
      .map((result, index) => ({ ...result, id: index + 1 }));
  }

  function matchesType(mime: string, fileFormat: string) {
    return mime.startsWith('audio/') && ['MP3', 'FLAC', 'WAV', 'OGG', 'OPUS'].includes(fileFormat.toUpperCase());
  }

  function maximumBytes() {
    const match = maximumSize.trim().match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB)?$/i);
    if (!match) return Number.POSITIVE_INFINITY;
    const units: Record<string, number> = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
    return Number(match[1]) * units[(match[2] || 'B').toUpperCase()];
  }

  function eligibleNetworkMatches(matches: NetworkResult[]) {
    return matches.filter((item) =>
      item.sources.length >= minimumSources
      && item.size <= maximumBytes()
      && matchesType(item.mime, item.format)
    );
  }

  function mergeSearchResults(networkMatches: NetworkResult[], localMatches: NativeFile[]) {
    const merged = new Map<string, Result>();
    for (const result of mapNetworkFiles(eligibleNetworkMatches(networkMatches))) {
      merged.set(result.fileId, result);
    }
    if (minimumSources <= 1) {
      for (const local of mapFiles(localMatches.filter((item) =>
        item.size <= maximumBytes() && matchesType(item.mime, item.format)
      ))) {
        const existing = merged.get(local.fileId);
        merged.set(local.fileId, existing
          ? { ...existing, remote: false, speed: 'Local', sources: Math.max(1, existing.sources) }
          : local);
      }
    }
    return [...merged.values()]
      .sort((left, right) => right.sources - left.sources || left.name.localeCompare(right.name))
      .map((result, index) => ({ ...result, id: index + 1 }));
  }

  function mergeNetworkPages(existing: NetworkResult[], incoming: NetworkResult[]) {
    const merged = new Map(existing.map((item) => [item.fileId, item]));
    for (const item of incoming) {
      const previous = merged.get(item.fileId);
      if (!previous) {
        merged.set(item.fileId, item);
        continue;
      }
      const sources = new Map(previous.sources.map((source) => [source.pubkey, source]));
      for (const source of item.sources) sources.set(source.pubkey, source);
      merged.set(item.fileId, { ...previous, ...item, sources: [...sources.values()] });
    }
    return [...merged.values()];
  }

  function shuffled<T>(items: T[]) {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const random = new Uint32Array(1);
      window.crypto.getRandomValues(random);
      const swapIndex = random[0] % (index + 1);
      [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
    }
    return copy;
  }

  function isActiveTransfer(transfer: Pick<Transfer, 'progress' | 'status'>) {
    // Receiving all bytes is not completion: verification and indexing still
    // need to finish before the download disappears from the native queue.
    return transfer.status !== 'Verified · Complete' && !/^(Failed|Cancelled|Refused|All seeders refused)/.test(transfer.status);
  }

  function isCompleteTransfer(transfer: Transfer) {
    return transfer.progress >= 100 && transfer.status === 'Verified · Complete' && Boolean(transfer.destination);
  }

  function isFinishedTransfer(transfer: Transfer) {
    return isCompleteTransfer(transfer) || /^(Failed|Cancelled|Refused|All seeders refused)/.test(transfer.status);
  }

  function mapTransfers(items: NativeTransfer[]): Transfer[] {
    return items.map((transfer) => ({
      id: transfer.id,
      fileId: transfer.fileId,
      name: transfer.filename,
      size: readableSize(transfer.size),
      speed: transfer.speed,
      progress: transfer.progress,
      status: transfer.status,
      destination: transfer.destination
    }));
  }

  function mergePendingTransfers(items: NativeTransfer[]): Transfer[] {
    const updated = mapTransfers(items);
    const pending = transfers.filter((transfer) => startingDownloads.has(transfer.fileId)
      && !updated.some((item) => item.fileId === transfer.fileId));
    return showAvailableDownloadSlots([...pending, ...updated]);
  }

  function showAvailableDownloadSlots(items: Transfer[]): Transfer[] {
    items = items.map((item) => item.status === 'Starting download'
      ? { ...item, status: 'Queued', speed: 'Queued' } : item);
    let available = Math.max(0, 2 - items.filter((item) => isActiveTransfer(item)
      && item.status !== 'Queued' && item.status !== 'Waiting to try again').length);
    // Native rows and optimistic rows are newest first. Reserve free slots for
    // the oldest queued tracks while the native dispatcher starts their requests.
    return items.slice().reverse().map((item) => {
      if (!paused && item.status === 'Queued' && available > 0) {
        available -= 1;
        return { ...item, status: 'Starting download', speed: 'Connecting…' };
      }
      return item;
    }).reverse();
  }

  async function applyTransferUpdate(items: NativeTransfer[]) {
    const generation = downloadGeneration;
    const updated = mergePendingTransfers(items);
    const completed = updated.filter((transfer) => isCompleteTransfer(transfer) && !isLocalFile(transfer.fileId));
    const vanished = transfers.filter((transfer) => !startingDownloads.has(transfer.fileId)
      && isActiveTransfer(transfer) && !updated.some((item) => item.fileId === transfer.fileId));
    transfers = updated;
    if (completed.length || vanished.length) downloadLibraryRefreshNeeded = true;
    if (downloadLibraryRefreshNeeded) {
      if (await refreshLocalLibrary()) downloadLibraryRefreshNeeded = false;
      if (generation !== downloadGeneration) return;
      const latest = completed[0] ?? vanished.find((transfer) => isLocalFile(transfer.fileId));
      if (latest) activityMessage = msg("{p0} downloaded, verified, and ready to play", { p0: latest.name });
    }
  }

  function isLocalFile(fileId: string) {
    return localFileIds.has(fileId);
  }

  function folderName(folder: string) {
    return folder || '(Deadwax folder)';
  }

  function libraryFolders(files = sharedFiles) {
    return [...new Set(files.map((file) => file.folder))]
      .sort((left, right) => folderName(left).localeCompare(folderName(right)));
  }

  /**
   * The template reads the shared list through derived values rather than
   * calling these directly: in legacy mode a template expression that only
   * names a function is never re-run, so a library that changed underneath it
   * went on drawing the rows it already had. The defaults keep every existing
   * call working, and naming the state in the derived statement is what makes
   * it a dependency.
   */
  function visibleSharedFiles(files = sharedFiles, folderView = libraryFolderView) {
    return folderView === '*'
      ? files
      : files.filter((file) => file.folder === folderView);
  }

  function audiobookFolderFiles(folderView: string, files: Array<NativeFile & { readableSize: string }>) {
    if (folderView === '*') return [];
    const prefix = `${folderView}/`;
    return files
      .filter((file) => file.folder === folderView || file.folder.startsWith(prefix))
      .sort((left, right) => `${left.folder}/${left.filename}`.localeCompare(`${right.folder}/${right.filename}`, undefined, { numeric: true, sensitivity: 'base' }));
  }

  function localPageCount(files: NativeFile[]) {
    return Math.max(1, Math.ceil(files.length / LOCAL_PAGE_SIZE));
  }

  function paginatedSharedFiles(files = visibleSharedFiles(), page = sharedLibraryPage) {
    const start = page * LOCAL_PAGE_SIZE;
    return files.slice(start, start + LOCAL_PAGE_SIZE);
  }

  function localPageRange(page: number, total: number) {
    if (!total) return '0';
    const start = page * LOCAL_PAGE_SIZE + 1;
    return `${start}–${Math.min(start + LOCAL_PAGE_SIZE - 1, total)}`;
  }

  function changeSharedLibraryPage(nextPage: number) {
    const files = visibleSharedFiles();
    sharedLibraryPage = Math.max(0, Math.min(nextPage, localPageCount(files) - 1));
    selectedShared = paginatedSharedFiles()[0] ?? null;
  }

  function changeLibraryFolder() {
    sharedLibraryPage = 0;
    selectedShared = visibleSharedFiles()[0] ?? null;
  }

  function selectLibraryFolder(folder: string) {
    libraryFolderView = folder;
    libraryFolderMenuOpen = false;
    changeLibraryFolder();
  }

  function containLibraryFolderMenu(node: HTMLElement) {
    const outside = (event: PointerEvent) => {
      if (libraryFolderMenuOpen && event.target instanceof Node && !node.contains(event.target)) {
        libraryFolderMenuOpen = false;
      }
    };
    const focusLeft = (event: FocusEvent) => {
      if (!(event.relatedTarget instanceof Node) || !node.contains(event.relatedTarget)) {
        libraryFolderMenuOpen = false;
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      libraryFolderMenuOpen = false;
      node.querySelector<HTMLButtonElement>('.folder-picker-toggle')?.focus();
    };
    document.addEventListener('pointerdown', outside);
    node.addEventListener('focusout', focusLeft);
    node.addEventListener('keydown', escape);
    return {
      destroy() {
        document.removeEventListener('pointerdown', outside);
        node.removeEventListener('focusout', focusLeft);
        node.removeEventListener('keydown', escape);
      }
    };
  }

  // Every one of these takes its state as an argument rather than reading it
  // out of the component. Svelte decides what a template expression depends on
  // from the identifiers written in that expression, so `{resultRange()}` names
  // only a function and the state read inside the body is invisible to it: the
  // expression runs once and never again. The list would sit frozen while the
  // caption beside it counted thousands of results. Passing the state in makes
  // the dependency visible, and costs nothing over a hundred rows.
  function resultPageCount(source: Result[]) {
    return Math.max(1, Math.ceil(source.length / SEARCH_PAGE_SIZE));
  }

  function paginatedResults(source: Result[], page: number) {
    const start = page * SEARCH_PAGE_SIZE;
    return source.slice(start, start + SEARCH_PAGE_SIZE);
  }

  function resultRange(source: Result[], page: number) {
    if (!source.length) return '0';
    const start = page * SEARCH_PAGE_SIZE + 1;
    return `${start}–${Math.min(start + SEARCH_PAGE_SIZE - 1, source.length)}`;
  }

  function availableResultTotal(source: Result[], totalAvailable: number) {
    return Math.max(source.length, totalAvailable);
  }

  /**
   * The advanced filters, applied to what came back.
   *
   * `format` is exact: every announcement names its own format. Bitrate is only
   * known where this computer read the file itself - a peer's announcement never
   * carries one - so a row with no bitrate is kept rather than dropped, and the
   * field says so.
   */
  let advancedFormat = 'Any';
  let minimumBitrate = 0;
  const ADVANCED_FORMATS = ['Any', 'FLAC', 'WAV', 'MP3', 'OPUS', 'M4A'];

  function passesAdvancedFilters(result: Result) {
    if (advancedFormat !== 'Any' && result.format.toUpperCase() !== advancedFormat) return false;
    if (minimumBitrate > 0 && result.bitrateKbps && result.bitrateKbps < minimumBitrate) return false;
    return true;
  }

  /**
   * The order the list view is in.
   *
   * Size is compared in bytes rather than in the words on screen, because "900 KB"
   * sorts before "1.2 MB" only if you look at the number.
   */
  type ResultSort = 'name' | 'artist' | 'album' | 'format' | 'size' | 'sources';
  let resultSort: ResultSort = 'name';
  let resultSortAsc = true;

  function sortResultsBy(key: ResultSort) {
    if (resultSort === key) {
      resultSortAsc = !resultSortAsc;
      return;
    }
    resultSort = key;
    resultSortAsc = true;
  }

  function sizeInBytes(text: string) {
    const match = text.match(/([\d.]+)\s*(B|KB|MB|GB|TB)/i);
    if (!match) return 0;
    const scale = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 }[match[2].toUpperCase() as 'B'] ?? 1;
    return Number(match[1]) * scale;
  }

  /**
   * The rows in the chosen order.
   *
   * The key and the direction are arguments rather than state read here, because
   * a helper that reads the component's own state is invisible to the change
   * tracking that redraws the list: the header's arrows moved, the order did
   * not. Naming them in the derivation is what makes a click reach the rows.
   */
  function orderedResults(source: Result[], sort: ResultSort, ascending: boolean) {
    const direction = ascending ? 1 : -1;
    const value = (result: Result) => {
      if (sort === 'size') return sizeInBytes(result.size);
      if (sort === 'sources') return result.sources;
      if (sort === 'artist') return (result.artist ?? '').toLowerCase();
      if (sort === 'album') return (result.album ?? '').toLowerCase();
      if (sort === 'format') return result.format.toLowerCase();
      return result.name.toLowerCase();
    };
    return [...source].sort((left, right) => {
      const a = value(left);
      const b = value(right);
      if (typeof a === 'number' && typeof b === 'number') return (a - b) * direction;
      return String(a).localeCompare(String(b)) * direction;
    });
  }

  // What the template reads. Each derivation names the state it comes from, so
  // each one re-runs when that state changes.
  $: shownResults = results.filter(passesAdvancedFilters);
  $: ordered = orderedResults(shownResults, resultSort, resultSortAsc);
  $: resultPageTotal = resultPageCount(ordered);
  $: resultPageItems = paginatedResults(ordered, resultPage);
  $: resultPageRange = resultPageItems.map((item) => item.fileId);
  // The rows on screen are what get asked about, once each: a discussion read is
  // a question to the relays, and a page of them is the size of the question.
  $: if (nativeReady && networkConnected && resultPageRange.length) void refreshDiscussionActivity(resultPageRange);
  $: resultRangeLabel = resultRange(shownResults, resultPage);
  $: resultAvailableTotal = availableResultTotal(shownResults, browseTotalAvailable);
  $: sharedVisible = visibleSharedFiles(sharedFiles, libraryFolderView);
  $: sharedRows = paginatedSharedFiles(sharedVisible, sharedLibraryPage);
  $: sharedPageCount = localPageCount(sharedVisible);
  $: sharedFolders = libraryFolders(sharedFiles);

  // The same rule, for the panes whose helper was still called from the markup. A
  // template expression that names only a function is not re-run when the state that
  // function reads changes: the Downloads library went on drawing the first hundred
  // files under a caption that had already said "Page 2 of 2", and the audiobook
  // preview kept the previous folder's chapters. Naming the state in a `$:` and
  // passing it in is what makes it a dependency.
  $: audiobookChapters = audiobookFolderFiles(libraryFolderView, sharedFiles);
  $: folderAudiobook = currentFolderAudiobook(localAudiobooks, libraryFolderView);
  $: selectedAudiobookIsComplete = selectedAudiobookComplete(selected?.audiobook, localFileIds);
  $: selectedAudiobookIsDownloading = selectedAudiobookDownloading(selected?.audiobook, audiobookDownloads);

  async function changeResultPage(nextPage: number) {
    if (nextPage >= resultPageCount(results) && browseCursor && !browseLoading) {
      await loadNextBrowsePage();
    }
    resultPage = Math.max(0, Math.min(nextPage, resultPageCount(results) - 1));
    selectResult(paginatedResults(results, resultPage)[0] ?? null);
  }

  function toPlayerTrack(file: NativeFile): PlayerTrack {
    return {
      fileId: file.fileId,
      name: file.title || file.filename,
      folder: file.folder,
      artist: file.artist,
      mime: file.mime
    };
  }

  function selectTagFile(file: NativeFile) {
    selectedTagFile = { ...file };
    tagDraft = file.tags;
  }

  /**
   * Pick a shared track, for playing from the list and for its tags.
   *
   * The tag editor and the shared list are one list now, so one click has to do
   * both jobs: the row that is selected is the row whose tags are on screen, and
   * there is no second table to keep in step with it.
   */
  function selectSharedRow(file: NativeFile) {
    selectedShared = { ...file };
    selectTagFile(file);
  }

  /**
   * What this computer can say about a local file, for the metadata preview.
   *
   * Nothing here is editable: the block exists to show the shape of the editor
   * that is not built yet, so every field is a disabled box holding the file's
   * own answer. The numbers come from the index, which is why a file this
   * computer has never read a bitrate for says so rather than guessing.
   */
  function sharedMetaFields(file: NativeFile | null): { label: string; value: string }[] {
    const shown = (value: string) => value?.trim() || '—';
    if (!file) {
      return [
        { label: $t("Title"), value: '—' },
        { label: $t("Artist"), value: '—' },
        { label: $t("Album"), value: '—' }
      ];
    }
    return [
      { label: $t("Title"), value: shown(file.title) },
      { label: $t("Artist"), value: shown(file.artist) },
      { label: $t("Album"), value: shown(file.album) },
      { label: $t("Format"), value: shown(file.format) },
      { label: $t("Bitrate"), value: file.bitrateKbps ? `${file.bitrateKbps} kbps` : '—' },
      { label: $t("Size"), value: readableSize(file.size) },
      { label: $t("File name"), value: shown(file.filename) },
      { label: $t("Folder"), value: folderName(file.folder) },
      { label: $t("Tags"), value: shown(file.tags) },
      { label: $t("MIME type"), value: shown(file.mime) }
    ];
  }

  async function saveTags() {
    if (!nativeReady || !selectedTagFile || tagSaving) return;
    const fileId = selectedTagFile.fileId;
    tagSaving = true;
    try {
      applySnapshot(await invoke<Snapshot>('save_file_tags', { fileId, tags: tagDraft }));
      selectedTagFile = sharedFiles.find((file) => file.fileId === fileId) ?? null;
      tagDraft = selectedTagFile?.tags ?? '';
      activityMessage = msg("Tags saved locally");
      if (networkConnected) {
        try {
          await invoke('publish_catalogue');
          activityMessage = msg("Tags saved and queued for Nostr publication");
        } catch (error) {
          activityMessage = msg("Tags saved locally · Nostr publication will retry later: {p0}", { p0: String(error) });
        }
      }
    } catch (error) {
      activityMessage = msg("Could not save tags: {p0}", { p0: String(error) });
    } finally {
      tagSaving = false;
    }
  }

  function sortedLibraryTracks() {
    return sharedFiles
      .map(toPlayerTrack)
      .sort((left, right) => left.folder.localeCompare(right.folder) || left.name.localeCompare(right.name));
  }

  function contextualPlayerQueue(track: PlayerTrack, origin: PlayerOrigin) {
    let queue: PlayerTrack[] = [];
    if (origin === 'downloads') {
      queue = sharedFiles.map(toPlayerTrack);
    } else if (origin === 'search') {
      queue = results
        .filter((result) => isLocalFile(result.fileId))
        .flatMap((result) => {
          const file = sharedFiles.find((item) => item.fileId === result.fileId);
          return file ? [toPlayerTrack(file)] : [];
        });
    } else if (origin === 'shared') {
      queue = visibleSharedFiles().map(toPlayerTrack);
    } else if (origin === 'audiobook' && activePlayerAudiobook) {
      queue = activePlayerAudiobook.chapters.flatMap((chapter) => {
        const file = sharedFiles.find((candidate) => candidate.fileId === chapter.fileId);
        return file ? [toPlayerTrack(file)] : [];
      });
    }
    return queue.some((item) => item.fileId === track.fileId) ? queue : [track];
  }

  function queueForTrack(track: PlayerTrack, mode: PlayerMode, origin: PlayerOrigin = playerOrigin) {
    const library = sortedLibraryTracks();
    if (!library.some((item) => item.fileId === track.fileId)) return [track];
    const contextualQueue = contextualPlayerQueue(track, origin);
    if (origin === 'audiobook') return mode === 'single' ? [track] : contextualQueue;
    if (origin !== 'direct') {
      if (mode === 'folder') return contextualQueue.filter((item) => item.folder === track.folder);
      return contextualQueue;
    }
    if (mode === 'all') return library;
    if (mode === 'folder') return library.filter((item) => item.folder === track.folder);
    return [track];
  }

  function selectPlayingTrack(track: PlayerTrack) {
    if (playerOrigin === 'search') {
      const index = results.findIndex((item) => item.fileId === track.fileId);
      if (index >= 0) {
        resultPage = Math.floor(index / SEARCH_PAGE_SIZE);
        selectResult(results[index]);
      }
    } else if (playerOrigin === 'downloads') {
      const file = sharedFiles.find((item) => item.fileId === track.fileId);
      if (file) {
        const index = visibleSharedFiles().findIndex((item) => item.fileId === track.fileId);
        if (index >= 0) sharedLibraryPage = Math.floor(index / LOCAL_PAGE_SIZE);
        selectSharedRow(file);
      }
    } else if (playerOrigin === 'shared') {
      const file = sharedFiles.find((item) => item.fileId === track.fileId);
      if (file) {
        const index = visibleSharedFiles().findIndex((item) => item.fileId === track.fileId);
        if (index >= 0) sharedLibraryPage = Math.floor(index / LOCAL_PAGE_SIZE);
        selectSharedRow(file);
      }
    }
  }

  function formatPlayerTime(seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const whole = Math.floor(seconds);
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
  }

  async function loadPlayerTrack(index: number) {
    const track = playerQueue[index];
    if (!track || playerLoading) return;
    playerLoading = true;
    playerQueueIndex = index;
    currentTrack = track;
    selectPlayingTrack(track);
    playerCurrentTime = 0;
    playerDuration = 0;
    playerEnded = false;
    try {
      applyPlaybackStatus(await invoke<PlaybackStatus>('play_audio', { fileId: track.fileId }));
      if (!lastPlayerError) activityMessage = msg("Playing {p0}{p1}", { p0: track.name, p1: track.folder ? ` · ${track.folder}` : '' });
    } catch (error) {
      playerPlaying = false;
      playerEnded = true;
      lastPlayerError = String(error);
      activityMessage = msg("Playback failed: {p0}", { p0: lastPlayerError });
    } finally {
      playerLoading = false;
    }
  }

  async function playAudio(fileId: string, name: string, mode: PlayerMode = playerMode, origin: PlayerOrigin = 'direct') {
    if (!nativeReady || !fileId) return;
    const indexed = sharedFiles.find((file) => file.fileId === fileId);
    const track = indexed
      ? toPlayerTrack(indexed)
      : { fileId, name, folder: '', artist: '', mime: '' };
    activePlayerAudiobook = null;
    playerOrigin = origin;
    playerMode = indexed ? mode : 'single';
    playerQueueRemote = false;
    playerQueueOrder = queueForTrack(track, playerMode, playerOrigin);
    playerQueue = playerShuffle ? shuffledQueue(playerQueueOrder, fileId) : playerQueueOrder;
    const index = Math.max(0, playerQueue.findIndex((item) => item.fileId === fileId));
    await loadPlayerTrack(index);
  }

  async function togglePlayer() {
    if (!currentTrack) {
      if (activeView === 'Downloads' && selectedTagFile) await playAudio(selectedTagFile.fileId, selectedTagFile.filename, playerMode, 'downloads');
      else if (activeView === 'Shared' && selectedShared) await playAudio(selectedShared.fileId, selectedShared.filename, playerMode, 'shared');
      else if (activeView === 'Search' && selected && isLocalFile(selected.fileId)) await playAudio(selected.fileId, selected.name, playerMode, 'search');
      else activityMessage = msg("Select a local song to play");
      return;
    }
    if (playerEnded) {
      await loadPlayerTrack(playerQueueIndex);
      return;
    }
    try { applyPlaybackStatus(await invoke<PlaybackStatus>('toggle_audio')); }
    catch (error) { activityMessage = msg("Playback failed: {p0}", { p0: String(error) }); }
  }

  async function stopPlayer() {
    try { applyPlaybackStatus(await invoke<PlaybackStatus>('stop_audio')); }
    catch (error) { activityMessage = msg("Could not stop playback: {p0}", { p0: String(error) }); return; }
    // The native output stream is deliberately released on Stop. Treat the
    // track as reloadable so pressing Play opens it again from the beginning.
    playerEnded = true;
    if (currentTrack) activityMessage = msg("Stopped {p0}", { p0: currentTrack.name });
  }

  async function nextPlayerTrack() {
    if (playerQueueIndex + 1 < playerQueue.length) await loadPlayerTrack(playerQueueIndex + 1);
    else stopPlayer();
  }

  async function previousPlayerTrack() {
    if (playerCurrentTime > 3 || playerQueueIndex <= 0) {
      try { applyPlaybackStatus(await invoke<PlaybackStatus>('seek_audio', { seconds: 0 })); }
      catch (error) { activityMessage = msg("Could not rewind playback: {p0}", { p0: String(error) }); }
      return;
    }
    await loadPlayerTrack(playerQueueIndex - 1);
  }

  async function playerTrackEnded() {
    playerPlaying = false;
    playerEnded = true;
    // Repeating one track is the whole answer: the queue is irrelevant.
    if (playerRepeat === 'one') {
      await loadPlayerTrack(playerQueueIndex);
      return;
    }
    if (playerMode !== 'single' && playerQueueIndex + 1 < playerQueue.length) {
      await loadPlayerTrack(playerQueueIndex + 1);
      return;
    }
    // The end of the queue, which is only the end when repeat says it is.
    if (playerRepeat === 'all' && playerQueue.length > 1) await loadPlayerTrack(0);
  }

  function changePlayerMode() {
    window.localStorage.setItem('napstr-player-mode', playerMode);
    if (!currentTrack) return;
    // A queue a phone chose is not a function of this window's mode, so it is
    // left exactly as the phone sent it.
    if (!playerQueueRemote) playerQueueOrder = queueForTrack(currentTrack, playerMode, playerOrigin);
    applyPlayerQueueOrder();
  }

  /** Lay the chosen order out for playing, honouring shuffle. */
  function applyPlayerQueueOrder() {
    if (!currentTrack) return;
    playerQueue = playerShuffle
      ? shuffledQueue(playerQueueOrder, currentTrack.fileId)
      : playerQueueOrder;
    playerQueueIndex = Math.max(0, playerQueue.findIndex((item) => item.fileId === currentTrack?.fileId));
  }

  /** The track being played first, everything else shuffled after it. */
  function shuffledQueue(order: PlayerTrack[], fileId: string) {
    const playing = order.find((item) => item.fileId === fileId);
    if (!playing) return shuffled(order);
    return [playing, ...shuffled(order.filter((item) => item.fileId !== fileId))];
  }

  /**
   * Play the track a phone asked for, from the list the phone was looking at.
   *
   * The list arrives as file ids in the phone's order and is used in that order.
   * Tracks this computer does not hold are dropped, exactly as they are from its
   * own search results: it can only play what it has, and a queue that stops on
   * something unplayable is worse than a shorter one. `positionMs` is where the
   * phone had got to, so handing playback over resumes there instead of starting
   * the track again from the beginning.
   */
  async function playRemoteQueue(fileId: string, fileIds: string[], positionMs: number) {
    const order: PlayerTrack[] = [];
    for (const id of fileIds) {
      const file = sharedFiles.find((candidate) => candidate.fileId === id);
      if (file) order.push(toPlayerTrack(file));
    }
    if (!order.some((item) => item.fileId === fileId)) {
      activityMessage = 'That phone asked for a track this computer does not have';
      return;
    }
    activePlayerAudiobook = null;
    playerOrigin = 'direct';
    playerQueueRemote = true;
    // A list was asked for, so it is meant to play through. Leaving "Stop" in
    // force would end playback after the first track, which contradicts what the
    // phone just asked for, so the mode moves with it — and is written down so
    // the window's own select does not show a mode that is not in force.
    if (order.length > 1 && playerMode === 'single') {
      playerMode = 'all';
      window.localStorage.setItem('napstr-player-mode', playerMode);
    }
    playerQueueOrder = order;
    playerQueue = playerShuffle ? shuffledQueue(order, fileId) : order;
    await loadPlayerTrack(Math.max(0, playerQueue.findIndex((item) => item.fileId === fileId)));
    if (positionMs > 0) await seekToPosition(positionMs / 1000);
  }

  /** Resume where a phone had got to, clamped to the length of what is loaded. */
  async function seekToPosition(seconds: number) {
    if (!currentTrack || !Number.isFinite(seconds) || seconds <= 0) return;
    const target = playerDuration > 0 ? Math.min(seconds, playerDuration) : seconds;
    try {
      applyPlaybackStatus(await invoke<PlaybackStatus>('seek_audio', { seconds: target }));
      playerCurrentTime = target;
      playerEnded = false;
    } catch (error) {
      activityMessage = msg("Could not seek in this track: {p0}", { p0: String(error) });
    }
  }

  /**
   * Carry out a transport command a phone sent.
   *
   * Only what the native player cannot manage alone arrives here, which is why
   * there is nothing to do for pause and seek. Volume does arrive, and is only
   * shown: the player has already been told, and this window follows it rather
   * than telling it again.
   */
  async function handleRemoteCommand(command: RemotePlaybackCommand) {
    switch (command.type) {
      case 'play':
        if (!playerPlaying) await togglePlayer();
        break;
      case 'toggle':
        await togglePlayer();
        break;
      case 'next':
        await nextPlayerTrack();
        break;
      case 'previous':
        await previousPlayerTrack();
        break;
      case 'volume':
        adoptPlayerVolume(command.percent / 100);
        break;
      case 'repeat':
        playerRepeat = command.mode;
        break;
      case 'shuffle':
        playerShuffle = command.enabled;
        applyPlayerQueueOrder();
        break;
      // The audio has already stopped at the native player's end, so the only
      // thing left is for this window to agree: a track that is no longer
      // loaded has to be reloadable rather than playable.
      case 'stop':
        playerPlaying = false;
        playerEnded = true;
        break;
      case 'handoff':
        playerPlaying = false;
        playerEnded = true;
        activityMessage = msg("Deadwax took playback over");
        break;
      case 'playTrack':
        await playRemoteQueue(command.fileId, command.queue, command.positionMs ?? 0);
        break;
    }
  }

  /**
   * Tell the bridge what the queue looks like. It cannot see any of this, and a
   * phone shows a queue length and enables "next" from it.
   *
   * The file ids go too, because they are what a handoff answers with: a phone
   * taking playback over adopts this list, and the length alone would leave it
   * unable to say what comes next.
   */
  async function publishPlayerQueueFacts(facts: {
    len: number;
    index: number;
    fileIds: string[];
    repeat: RemoteRepeat;
    shuffle: boolean;
  }) {
    const key = `${facts.len}:${facts.index}:${facts.repeat}:${facts.shuffle}:${facts.fileIds.join(',')}`;
    if (key === publishedQueueFacts) return;
    publishedQueueFacts = key;
    try {
      await invoke('publish_playback_state', { snapshot: facts });
    } catch {
      // A phone that hears nothing simply sees no queue, as it did before.
    }
  }

  // Re-runs whenever the queue or its state changes. The facts are assembled in
  // the statement rather than inside the call, because a function that reads the
  // variables itself never makes this depend on them.
  $: queueFacts = {
    len: playerQueue.length,
    index: playerQueueIndex,
    fileIds: playerQueue.map((track) => track.fileId),
    repeat: playerRepeat,
    shuffle: playerShuffle
  };
  $: if (nativeReady) void publishPlayerQueueFacts(queueFacts);

  // The player starts at whatever volume it had, and remembers nothing between
  // runs, so the stored preference is pushed once when it becomes available.
  $: if (nativeReady && !pushedPlayerVolume) {
    pushedPlayerVolume = true;
    volumeSentAt = Date.now();
    invoke<PlaybackStatus>('set_audio_volume', { volume: playerVolume }).catch(() => {});
  }

  async function seekPlayer(event: Event) {
    try {
      applyPlaybackStatus(await invoke<PlaybackStatus>('seek_audio', { seconds: Number((event.currentTarget as HTMLInputElement).value) }));
      playerEnded = false;
    } catch (error) { activityMessage = msg("Could not seek in this track: {p0}", { p0: String(error) }); }
  }

  function changePlayerVolume(event: Event) {
    playerVolume = Number((event.currentTarget as HTMLInputElement).value);
    volumeSentAt = Date.now();
    // Always told, even with nothing loaded: the player is the one that owns the
    // volume, so a change made while it is idle is the volume the next track
    // starts at.
    invoke<PlaybackStatus>('set_audio_volume', { volume: playerVolume }).catch(() => {});
    window.localStorage.setItem('napstr-player-volume', String(playerVolume));
  }

  /**
   * Follow the player's volume, which is the only place one is kept.
   *
   * A phone changing the volume is the reason this exists: the slider has to
   * move with it rather than disagreeing until the next poll. A change this
   * window just sent is skipped, so that a drag cannot be yanked backwards by an
   * answer to its own request.
   */
  function adoptPlayerVolume(volume: number) {
    if (!Number.isFinite(volume)) return;
    const value = Math.min(1, Math.max(0, volume));
    if (Math.abs(value - playerVolume) < 0.005) return;
    if (Date.now() - volumeSentAt < 500) return;
    playerVolume = value;
    window.localStorage.setItem('napstr-player-volume', String(value));
  }

  function applyPlaybackStatus(status: PlaybackStatus) {
    // Read before the track check below: a volume can change while nothing is
    // loaded, and the slider still has to be right when something loads.
    adoptPlayerVolume(status.volume);
    if (!currentTrack || status.fileId !== currentTrack.fileId) return;
    if (status.error) {
      playerPlaying = false;
      playerEnded = true;
      if (status.error !== lastPlayerError) activityMessage = msg("Playback failed: {p0}", { p0: status.error });
      lastPlayerError = status.error;
      return;
    }
    lastPlayerError = '';
    playerCurrentTime = status.currentTime;
    playerDuration = status.duration;
    playerPlaying = status.playing;
  }

  function syncResultLocality() {
    if (resultUser?.npub === identityNpub) {
      results = mergeSearchResults([], sharedFiles);
    } else if (resultsAreNetwork) {
      results = results.map((result) => {
        if (result.audiobook) {
          const localBook = localAudiobooks.find((book) => book.audiobookId === result.audiobook?.audiobookId);
          const audiobook = localBook ? { ...result.audiobook, local: true, localFolder: localBook.localFolder } : result.audiobook;
          return { ...result, audiobook, remote: !audiobook.local, speed: audiobook.local ? 'Local' : 'Tor' };
        }
        const local = isLocalFile(result.fileId);
        return { ...result, remote: !local, speed: local ? 'Local' : 'Tor' };
      });
    } else if (!query.trim() || searchedQuery === 'local catalogue' || searchedQuery === 'All audio') {
      results = mergeAudiobooks(mapFiles(sharedFiles), [], query.trim());
    } else {
      results = results.filter((result) => isLocalFile(result.fileId));
    }
    resultPage = Math.min(resultPage, resultPageCount(results) - 1);
    reconcileResultSelection();
  }

  function applySnapshot(snapshot: Snapshot) {
    nativeReady = snapshot.native;
    indexedBytes = snapshot.indexedBytes;
    napstrFolder = snapshot.settings.napstrFolder;
    nostrRelays = snapshot.settings.nostrRelays;
    displayName = snapshot.settings.displayName;
    profileAbout = snapshot.settings.profileAbout;
    profilePicture = snapshot.settings.profilePicture;
    localAudiobooks = snapshot.audiobooks;
    sharedFiles = snapshot.files.map((file) => ({ ...file, name: file.filename, readableSize: readableSize(file.size), peers: 0 }));
    localFileIds = new Set(snapshot.files.map((file) => file.fileId));
    sharedLibraryPage = Math.min(sharedLibraryPage, localPageCount(visibleSharedFiles()) - 1);
    sharedLibraryPage = Math.min(sharedLibraryPage, localPageCount(visibleSharedFiles()) - 1);
    if (selectedShared) selectedShared = snapshot.files.find((file) => file.fileId === selectedShared?.fileId) ?? null;
    resultUser = null;
    searchUser = null;
    matchingUsers = [];
    results = mergeAudiobooks(mapFiles(snapshot.files), [], '');
    resultPage = 0;
    resultsAreNetwork = false;
    selectResult(results[0] ?? null);
    searchedQuery = 'local catalogue';
    transfers = mapTransfers(snapshot.transfers);
    activityMessage = snapshot.files.length ? msg("{p0} local files indexed and ready", { p0: snapshot.files.length }) : msg("Choose a Deadwax folder to begin");
  }

  async function refreshSnapshot() {
    try { applySnapshot(await invoke<Snapshot>('get_snapshot')); } catch { nativeReady = false; }
  }

  function parseSemver(value: string) {
    const match = value.trim().match(/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
    if (!match) return null;
    return { numbers: match.slice(1, 4).map(Number), prerelease: match[4]?.split('.') ?? [] };
  }

  function compareSemver(leftValue: string, rightValue: string) {
    const left = parseSemver(leftValue);
    const right = parseSemver(rightValue);
    if (!left || !right) return 0;
    for (let index = 0; index < 3; index += 1) {
      if (left.numbers[index] !== right.numbers[index]) return left.numbers[index] > right.numbers[index] ? 1 : -1;
    }
    if (!left.prerelease.length || !right.prerelease.length) {
      return left.prerelease.length === right.prerelease.length ? 0 : left.prerelease.length ? -1 : 1;
    }
    const length = Math.max(left.prerelease.length, right.prerelease.length);
    for (let index = 0; index < length; index += 1) {
      const leftPart = left.prerelease[index];
      const rightPart = right.prerelease[index];
      if (leftPart === undefined || rightPart === undefined) return leftPart === undefined ? -1 : 1;
      if (leftPart === rightPart) continue;
      const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null;
      const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null;
      if (leftNumber !== null && rightNumber !== null) return leftNumber > rightNumber ? 1 : -1;
      if (leftNumber !== null || rightNumber !== null) return leftNumber !== null ? -1 : 1;
      return leftPart > rightPart ? 1 : -1;
    }
    return 0;
  }

  function validNapstrReleaseUrl(value: unknown): value is string {
    return typeof value === 'string' && /^https:\/\/github\.com\/StateAntigen\/deadwax\/releases\/tag\/[0-9A-Za-z._+-]{1,100}$/.test(value);
  }

  async function checkForNewRelease() {
    const cacheKey = 'napstr-latest-release';
    let cachedRelease: GitHubRelease | null = null;
    let release: GitHubRelease | null = null;
    try {
      const cached = JSON.parse(window.localStorage.getItem(cacheKey) ?? 'null') as { checkedAt?: number; release?: GitHubRelease | null } | null;
      cachedRelease = cached?.release ?? null;
    } catch { /* ignore invalid old cache data */ }
    try {
      const response = await fetch('https://api.github.com/repos/StateAntigen/deadwax/releases/latest', {
        headers: { Accept: 'application/vnd.github+json' }
      });
      if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
      release = await response.json() as GitHubRelease;
      window.localStorage.setItem(cacheKey, JSON.stringify({ checkedAt: Date.now(), release }));
    } catch { release = cachedRelease; }
    if (typeof release?.tag_name !== 'string' || !validNapstrReleaseUrl(release.html_url)) return;
    if (compareSemver(release.tag_name, appVersion) > 0) {
      newRelease = { version: release.tag_name.replace(/^v/, ''), url: release.html_url };
    }
  }

  async function openNewRelease() {
    if (!newRelease) return;
    try {
      await invoke('open_release_url', { url: newRelease.url });
    } catch (error) {
      activityMessage = msg("Could not open the release page: {p0}", { p0: String(error) });
    }
  }

  async function openNapstrfyWebsite(event: MouseEvent) {
    event.preventDefault();
    try {
      await invoke('open_napstrfy_website');
    } catch (error) {
      activityMessage = msg("Could not open the Deadwax website: {p0}", { p0: String(error) });
    }
  }

  function chatNameColor(npub: string) {
    const colours = ['#0000b8', '#006400', '#8b008b', '#a00020', '#005f73', '#7a3e00', '#4b0082', '#006b3c', '#9b1c00', '#0047ab', '#7030a0', '#007070'];
    let hash = 2166136261;
    for (let index = 0; index < npub.length; index += 1) {
      hash ^= npub.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return colours[(hash >>> 0) % colours.length];
  }

  function mergeChatMessages(current: TrollboxMessage[], incoming: TrollboxMessage[]) {
    return [...new Map([...current, ...incoming].map((message) => [message.eventId, message])).values()]
      .sort((a, b) => a.createdAt - b.createdAt || a.eventId.localeCompare(b.eventId));
  }

  function openChatLog(node: HTMLDivElement) {
    let alive = true;
    void tick().then(() => { if (alive) node.scrollTop = node.scrollHeight; });
    return { destroy() { alive = false; } };
  }

  function chatScrollRestorer(node: HTMLDivElement | undefined, initial: boolean, older: boolean) {
    if (!node) return () => {};
    const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 40;
    if (initial || (!older && atBottom)) return () => { node.scrollTop = node.scrollHeight; };
    // Keep the same visible message in place, including if the user moved while
    // the network request was pending or a loading notice changes height.
    const anchor = [...node.querySelectorAll<HTMLElement>('.trollbox-message')]
      .find((item) => item.getBoundingClientRect().bottom > node.getBoundingClientRect().top);
    const offset = anchor ? anchor.getBoundingClientRect().top - node.getBoundingClientRect().top : 0;
    return () => {
      if (anchor?.isConnected) node.scrollTop += anchor.getBoundingClientRect().top - node.getBoundingClientRect().top - offset;
    };
  }

  async function refreshTrollbox(older = false) {
    if (!nativeReady || !networkConnected || (older && (!trollboxHasMore || !trollboxMessages.length))) return;
    if (trollboxPollPending) {
      if (!older) trollboxRefreshAgain = true;
      return;
    }
    trollboxPollPending = true;
    const initial = trollboxMessages.length === 0;
    trollboxLoading = initial || older;
    const first = trollboxMessages[0];
    try {
      const messages = await invoke<TrollboxMessage[]>('get_trollbox_messages', {
        before: older ? { createdAt: first.createdAt, eventId: first.eventId } : null
      });
      const restoreScroll = chatScrollRestorer(trollboxLog, initial, older);
      trollboxMessages = mergeChatMessages(trollboxMessages, messages);
      if (older) trollboxHasMore = messages.length === CHAT_PAGE_SIZE;
      trollboxError = '';
      trollboxLoading = false;
      await tick();
      restoreScroll();
    } catch (error) {
      trollboxError = String(error);
    } finally {
      trollboxLoading = false;
      trollboxPollPending = false;
      if (trollboxRefreshAgain) {
        trollboxRefreshAgain = false;
        void refreshTrollbox();
      }
    }
  }

  // ---- Album covers (kind 30427) -------------------------------------------
  //
  // Reading the covers other people published needs no opt-in: it is an
  // ordinary relay query, and it happens as results appear. The two switches
  // here are the parts that leave Deadwax — asking a central service, and
  // signing with the user's own key. Both are stored by the backend, and the
  // backend's worker acts on them by itself: there is no button to press for a
  // pass to happen, and leaving one on means it resumes after a restart.
  type CoverCandidate = { key: string; artist: string; album: string; trackCount: number; source: string };
  /** An album this computer holds that no cover answers. */
  type CoverGap = {
    key: string;
    artist: string;
    album: string;
    tracks: number;
    /** `failed`, `not_looked_up` or `no_art`. */
    state: string;
    source: string;
    /** The most recent reason recorded for it, when there is one. */
    note: string;
  };
  /** One attempt, the way the log kept it. */
  type CoverLogRow = {
    at: string;
    key: string;
    artist: string;
    album: string;
    outcome: string;
    source: string;
    message: string;
  };
  type CoverStatus = {
    lookupExternal: boolean;
    publishClaims: boolean;
    running: boolean;
    current: string;
    pending: number;
    remaining: number;
    published: number;
    resolved: number;
    alreadyCovered: number;
    noArt: number;
    failed: number;
    backedOff: number;
    stopped: boolean;
    /** One domain per line. Empty means any HTTPS host. */
    allowedArtHosts: string;
    /** Pictures this computer is holding, and what they take on disk. */
    artCached: number;
    artBytes: number;
    /** Albums whose art is resolved here and whose pictures are not held yet. */
    artPending: number;
    artPaused: boolean;
    message: string;
  };
  /** How many albums the Covers tab previews. The worker itself is unbounded. */
  const COVER_QUEUE_PREVIEW = 25;
  /** How many albums the missing-cover list shows, and how many log lines. */
  const COVER_GAP_PREVIEW = 400;
  const COVER_LOG_PREVIEW = 120;
  // Deliberately plain `let`s, like every other variable in this file. A single
  // rune anywhere in the component compiles the whole thing in runes mode, which
  // silently makes every plain `let` here non-reactive - including the
  // `desktopRuntime` gate that draws the window. The result is a blank white
  // screen with no error in the console, which is exactly what a stray `$state`
  // in this file cost once already.
  let coverQueue: CoverCandidate[] = [];
  let coverStatus: CoverStatus | null = null;
  let coverLoading = false;
  let coverError = '';
  /** Albums no cover answers, worst first, and what each lookup actually did. */
  let coverMissing: CoverGap[] = [];
  let coverLog: CoverLogRow[] = [];
  // The art domain list is edited in a text box, so the box holds the draft and
  // `allowedArtHostsSaved` holds what the host actually has. A background status
  // refresh must not overwrite what somebody is halfway through typing, so the
  // stored value is only adopted while the two still agree.
  let allowedArtHosts = '';
  let allowedArtHostsSaved = '';
  /**
   * The hosts Deadwax itself reads art from, and the list to offer somebody who
   * wants the filter on without having to work out the domains by hand. Apple
   * is named at `mzstatic.com` because that is where its artwork redirects to:
   * `itunes.apple.com` answers the search, not the picture.
   */
  const RECOMMENDED_ART_HOSTS = ['coverartarchive.org', 'archive.org', 'mzstatic.com'];
  // Bumped when the worker produces art, which is what makes the tiles ask
  // again. A long pass would otherwise leave every square blank until it ended.
  let coverRevision = 0;
  let lastCoverRevisionAt = 0;
  /**
   * The album list.
   *
   * The tab used to be four panels that each answered a different half-question,
   * which is why it read as disjointed. It is one list now, sorted five ways, with
   * the pass's own log underneath it: every album this computer knows about, what
   * it holds, and who signed the picture it uses.
   */
  type CoverRow = { key: string; artist: string; album: string; held: boolean; thumb: boolean; outcome: string; signedBy: string; reason: string };
  type CoverInventory = { rows: CoverRow[]; total: number };
  const COVER_PAGE_SIZE = 20;
  const coverSorts = [
    { id: 'missing' as const, label: 'Missing art' },
    { id: 'held' as const, label: 'Art held here' },
    { id: 'claimed' as const, label: 'Signed by somebody' },
    { id: 'failed' as const, label: 'Lookups that failed' },
    { id: 'album' as const, label: 'A–Z' },
  ];
  let coverSort: (typeof coverSorts)[number]['id'] = 'missing';
  let coverPageIndex = 0;
  let coverInventory: CoverInventory = { rows: [], total: 0 };

  /** What the row's picture column says, in the plainest word that is true. */
  function coverRowState(row: CoverRow) {
    if (row.held) return 'Held here';
    if (row.reason) return 'Lookup failed';
    if (row.outcome === 'none') return 'Nobody has one';
    if (row.outcome === 'found') return 'Found, not fetched';
    return 'Not looked up yet';
  }

  function setCoverSort(sort: (typeof coverSorts)[number]['id']) {
    if (coverSort === sort) return;
    coverSort = sort;
    coverPageIndex = 0;
    void refreshCoverInventory();
  }

  function changeCoverPage(page: number) {
    const next = Math.max(0, page);
    if (next === coverPageIndex) return;
    coverPageIndex = next;
    void refreshCoverInventory();
  }

  async function refreshCoverInventory() {
    try {
      coverInventory = await invoke<CoverInventory>('cover_inventory', {
        sort: coverSort,
        offset: coverPageIndex * COVER_PAGE_SIZE,
        limit: COVER_PAGE_SIZE,
      });
    } catch (error) {
      coverError = String(error);
    }
  }

  // ---- Results presentation ------------------------------------------------
  //
  // A view preference rather than a privacy one, so it lives beside the player
  // mode in the webview's own storage rather than in the database.
  const RESULTS_VIEW_KEY = 'napstr-results-view';
  let resultsView: 'list' | 'thumb' = 'list';

  function setResultsView(view: 'list' | 'thumb') {
    resultsView = view;
    try {
      window.localStorage.setItem(RESULTS_VIEW_KEY, view);
    } catch {
      // A preference that cannot be stored is still honoured for this session.
    }
  }

  /** Are either of the two cover switches on? Passed the status it reads for the
   *  same reason `paginatedResults` is passed the results: a helper that reads
   *  component state itself is invisible to the template's dependency tracking. */
  function coverOptIn(status: CoverStatus | null) {
    return Boolean(status?.lookupExternal || status?.publishClaims);
  }

  /** The worker changed what art exists, so nothing cached may survive it.
   *  Throttled: a pass resolving hundreds of albums must not make the window
   *  re-ask for a page of tiles that many times. */
  function refreshCoverArtwork() {
    const now = Date.now();
    if (now - lastCoverRevisionAt < 5000) return;
    lastCoverRevisionAt = now;
    clearCoverCache();
    coverRevision += 1;
  }

  async function refreshCoverStatus() {
    try {
      coverStatus = await invoke<CoverStatus>('cover_status');
    } catch {
      // The Covers tab reports its own errors; this is only for the switches.
    }
  }

  async function refreshCovers() {
    coverLoading = true;
    coverError = '';
    try {
      // A host that cannot answer this yet (an older build, or a test harness
      // without the command) leaves the tab empty rather than painting an error
      // across it: nothing here is the button the person came to press.
      const status = await invoke<CoverStatus | null>('cover_status');
      if (status) {
        coverStatus = status;
        if (allowedArtHosts === allowedArtHostsSaved) {
          allowedArtHosts = status.allowedArtHosts;
          allowedArtHostsSaved = allowedArtHosts;
        }
      }
      coverQueue = await invoke<CoverCandidate[]>('cover_candidates', { limit: COVER_QUEUE_PREVIEW });
      // The two diagnostic lists are read with the same call that refreshes the
      // tab: an album that just failed is the thing a person came here to see.
      coverMissing = await invoke<CoverGap[]>('cover_missing', { limit: COVER_GAP_PREVIEW });
      coverLog = await invoke<CoverLogRow[]>('cover_lookup_log', { limit: COVER_LOG_PREVIEW });
      await refreshCoverInventory();
    } catch (error) {
      coverError = String(error);
    } finally {
      coverLoading = false;
    }
  }

  /** When a log line happened, in the reader's own clock. */
  function coverLogTime(at: string) {
    const stamp = new Date(at);
    return Number.isNaN(stamp.getTime()) ? at : stamp.toLocaleTimeString();
  }

  /** How a missing album's state reads to a person. */
  function coverGapState(state: string) {
    if (state === 'failed') return 'lookup failed';
    if (state === 'no_art') return 'no art anywhere';
    if (state === 'resolved_here') return 'art here, no claim';
    return 'not looked up yet';
  }

  /**
   * Save the art domain list.
   *
   * The host normalizes it — lowercase, one per line — and the box is refilled
   * from what it stored, so the list on screen is the list in force rather than
   * the string that was typed. Every cached square is then dropped, because a
   * host that has just been removed from the list must stop being drawn at once
   * rather than at the next restart.
   */
  async function saveAllowedArtHosts(hosts: string) {
    coverError = '';
    try {
      const status = await invoke<CoverStatus | null>('set_allowed_art_hosts', { hosts });
      if (status) {
        coverStatus = status;
        allowedArtHosts = status.allowedArtHosts;
        allowedArtHostsSaved = allowedArtHosts;
      }
      lastCoverRevisionAt = 0;
      refreshCoverArtwork();
    } catch (error) {
      coverError = String(error);
    }
  }

  async function setCoverPreferences(lookupExternal: boolean, publishClaims: boolean) {
    coverError = '';
    try {
      coverStatus = await invoke<CoverStatus>('set_cover_preferences', { lookupExternal, publishClaims });
    } catch (error) {
      coverError = String(error);
    }
  }

  /**
   * Stop or resume fetching pictures, for now.
   *
   * A pause rather than a switch: what is already held keeps working, and
   * nothing about it is remembered past this run, because a pause that outlived
   * its reason would be a cache that silently never fills.
   */
  async function setArtPaused(paused: boolean) {
    coverError = '';
    try {
      coverStatus = await invoke<CoverStatus>('set_art_fill_paused', { paused });
    } catch (error) {
      coverError = String(error);
    }
  }

  /**
   * Throw the held pictures away.
   *
   * Confirmed, because it is the one control here that takes something away: the
   * artwork on every paired phone has to come back over Iroh, and on a slow
   * connection that is not free. What this computer *knows* is untouched, so the
   * cache refills from claims it already holds.
   */
  async function clearArtCache() {
    if (!window.confirm('Throw away every picture this computer is holding? The artwork on your phones will be fetched again.')) {
      return;
    }
    coverError = '';
    try {
      coverStatus = await invoke<CoverStatus>('clear_art_cache');
      // The phones are holding pictures keyed by hashes that are about to be
      // handed out again from scratch, so they are told to ask again.
      lastCoverRevisionAt = 0;
      refreshCoverArtwork();
    } catch (error) {
      coverError = String(error);
    }
  }

  /** A size a person can read, for the cache's own numbers. */
  function readableBytes(bytes: number) {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} kB`;
    return `${bytes} B`;
  }

  /** Skip the wait: ask the worker to look at whatever is new right now. */
  async function lookForCoversNow() {
    coverError = '';
    try {
      await invoke('nudge_cover_worker');
    } catch (error) {
      coverError = String(error);
    }
  }

  async function stopCoverPass() {
    try {
      await invoke('cancel_cover_scan');
    } catch (error) {
      coverError = String(error);
    }
  }

  /** Report the albums the results pane is drawing.
   *
   * Silent and debounced — this is not a button. It is what makes "albums seen
   * in search results" reach the cover worker without scanning the catalogue
   * cache, which on a used install holds thousands of albums nobody looked at.
   * Pages are accumulated so flicking quickly through results still reports
   * every page that was actually drawn. */
  let noteVisibleHandle: number | null = null;
  const notedAlbums = new Map<string, CoverAlbum>();

  function noteVisibleAlbums(currentResults: Result[], page: number) {
    if (!desktopRuntime || activeView !== 'Search') return;
    for (const album of albumsFor(paginatedResults(currentResults, page))) {
      notedAlbums.set(`${album.artist}\u0000${album.album}`, album);
    }
    if (noteVisibleHandle !== null) window.clearTimeout(noteVisibleHandle);
    noteVisibleHandle = window.setTimeout(flushNotedAlbums, 800);
  }

  function flushNotedAlbums() {
    noteVisibleHandle = null;
    if (!notedAlbums.size) return;
    const albums = [...notedAlbums.values()];
    notedAlbums.clear();
    // One write per page of results, whether or not a switch is on: reporting
    // is harmless, and it means switching lookups on covers what is on screen.
    void invoke('note_visible_albums', { albums }).catch(() => {
      // A window that cannot report says nothing about the results themselves.
    });
  }

  // Re-runs whenever the page of results the pane is showing changes.
  $: noteVisibleAlbums(results, resultPage);

  /** The album whose art is being chosen by hand, or null when the tool is shut. */
  let coverPicker: { artist: string; album: string; currentArt: string } | null = null;

  /** Open the manual art tool for one album, showing the art in use now so the
   *  person can compare it against what MusicBrainz offers. */
  async function openCoverPicker(artist: string, album: string) {
    const trimmedArtist = artist.trim();
    const trimmedAlbum = album.trim();
    if (!trimmedArtist || !trimmedAlbum) return;
    coverPicker = { artist: trimmedArtist, album: trimmedAlbum, currentArt: '' };
    try {
      const cover = await coverFor(trimmedArtist, trimmedAlbum);
      if (coverPicker && coverPicker.artist === trimmedArtist && coverPicker.album === trimmedAlbum) {
        coverPicker = { ...coverPicker, currentArt: artUrl(cover, false) };
      }
    } catch {
      // The art is only here for comparison; the tool works without it.
    }
  }

  /** A pick was filed, so every cached answer for it is now wrong. */
  function coverPickApplied() {
    clearCoverCache();
    coverRevision += 1;
    void refreshCoverStatus();
  }

  /** The cover being reported, or null. Reporting is about the claim that is
   *  actually winning for this album, which is why only the key travels. */
  let coverReport: { key: string; label: string } | null = null;

  function openCoverReport(artist: string, album: string) {
    const key = coverKey(artist, album);
    if (!key) {
      activityMessage = 'This album names no artist and album to report.';
      return;
    }
    coverReport = {
      key,
      label: `${album.trim() || 'Untitled'} · ${artist.trim() || 'Unknown artist'}`
    };
  }

  let playlists: PlaylistSummary[] = [];
  let playlistsLoading = false;
  let playlistsError: string | Message = '';
  /**
   * This computer's own public key: the author half of every playlist it writes
   * down. Read from the host rather than from the network status, because a
   * playlist is edited offline too, and "is this row mine?" has to be answerable
   * while the relays are down.
   */
  let playlistAuthor = '';
  /** The playlist open in the editor, or null while the list is showing. */
  let playlistDraft: PlaylistDetail | null = null;
  /**
   * Whether the panel is the editor or the browser.
   *
   * A loaded playlist is what the right-hand column shows; the editor is a
   * deliberate step from it, because opening a playlist to read it and opening it
   * to change it used to be the same press and that made one of them surprising.
   */
  let playlistEditing = false;
  /** Grid or list, remembered per machine like the results view is. */
  let playlistView: 'list' | 'grid' = 'list';
  /** Which row the right-hand column is showing. */
  let selectedPlaylistKey = '';
  /**
   * The picture each playlist's tile draws, resolved the way the phone resolves
   * it: the first member that has both an artist and an album, in track order.
   * A summary carries no tags, so this is filled by reading the playlist once.
   */
  let playlistArt = new Map<string, { artist: string; album: string }>();
  /** The draft's members in the order the list shows them, which is the order
   *  that gets saved: positions are written from this, never typed. */
  let playlistMembers: PlaylistMember[] = [];
  /** The author's answer to "suggest words from the title?". It only applies
   *  while they have written no words of their own, and it is remembered here
   *  because the event cannot carry the difference between "no" and "not asked". */
  let playlistSuggestTags = true;
  let playlistSaving = false;
  let playlistError: string | Message = '';
  let playlistNotice: string | Message = '';
  let playlistCandidateQuery = '';
  let playlistCandidates: PlaylistCandidate[] = [];
  let playlistSearching = false;
  /**
   * This identity's own playlists as the relays last answered for them, or null
   * while they have not been read successfully.
   *
   * Null is not an empty list, and the list is drawn differently because of it:
   * "nobody has looked yet" must never be shown as "the relays do not have
   * these", which is the answer that invites a withdrawal.
   */
  let playlistRelays: PlaylistSummary[] | null = null;
  /** Live seeder counts for the members of the playlist open in the editor. */
  let playlistAvailability = new Map<string, number>();
  /** The list in its two tiers, built from the store and the relay answer. */
  let playlistTiers: { mine: PlaylistRow[]; theirs: PlaylistRow[] } = { mine: [], theirs: [] };

  /**
   * The list in two tiers: ours first, then everybody else's.
   *
   * Ours are this computer's own rows plus the coordinates the relays know and
   * it does not, which is the reconciliation: one of those can be restored, and
   * one only here can be withdrawn. Everybody else's were read off the relays
   * and are read-only here - a copy of one is a new playlist of this identity's,
   * with an id of its own.
   *
   * The two lists are taken as arguments rather than read here, because a helper
   * that reads this component's state itself is invisible to the change tracking
   * that would redraw the rows.
   */
  function buildPlaylistTiers(
    held: PlaylistSummary[],
    author: string,
    relays: PlaylistSummary[] | null
  ) {
    const coordinate = (row: PlaylistSummary) => `${row.author}|${row.playlistId}`;
    const isMine = (row: PlaylistSummary) => !row.author || !author || row.author === author;
    const answered = relays !== null;
    const onRelays = new Set((relays ?? []).map(coordinate));
    const mine: PlaylistRow[] = [];
    const theirs: PlaylistRow[] = [];
    for (const row of held) {
      if (!isMine(row)) {
        theirs.push({ ...row, state: 'theirs', withdrawable: false });
        continue;
      }
      // A playlist this computer holds is missing from the relays only when the
      // relays were asked and did not have it. Nothing is offered to withdraw on
      // the strength of a look that never happened, and one that was never
      // published is a draft rather than a playlist the relays have lost.
      const known = onRelays.has(coordinate(row));
      const state: PlaylistRowState = known
        ? 'held'
        : !row.published
          ? 'draft'
          : answered
            ? 'local'
            : 'held';
      mine.push({ ...row, state, withdrawable: state === 'local' });
    }
    for (const row of relays ?? []) {
      if (held.some((known) => coordinate(known) === coordinate(row))) continue;
      mine.push({ ...row, state: 'relays', withdrawable: false });
    }
    const newestFirst = (left: PlaylistRow, right: PlaylistRow) =>
      (right.updatedAt ?? 0) - (left.updatedAt ?? 0) || left.playlistId.localeCompare(right.playlistId);
    mine.sort(newestFirst);
    theirs.sort(newestFirst);
    return { mine, theirs };
  }

  $: playlistDraftIsMine = !playlistDraft || playlistIsMine(playlistDraft.author);
  $: playlistTiers = buildPlaylistTiers(playlists, playlistAuthor, playlistRelays);

  /** What each pair of keys is called: kind `0` name, or `npub` when they have none. */
  type PubkeyLabel = { pubkey: string; npub: string; name: string };
  let playlistOwners = new Map<string, string>();

  /**
   * How to name the person a row belongs to.
   *
   * A playlist carries the name its author chose for it, and that is what a row
   * shows. Where there is none - and for the people "From everyone else" lists -
   * the owner used to be printed as a truncated hex key, which nobody can read
   * or look up. Their kind `0` name is used when this computer has seen one -
   * read from what it already holds, never fetched for the purpose - and their
   * `npub` otherwise, which is their real identifier in the form people use.
   */
  function playlistOwner(row: { author: string; displayName?: string }) {
    if (!row.author) return '';
    return row.displayName?.trim() || playlistOwners.get(row.author) || row.author;
  }

  /**
   * Fill in the names for a set of rows before they are drawn.
   *
   * Awaited rather than drawn first and corrected later: a list that printed hex
   * for a moment and then swapped to a name would be a worse answer than one that
   * arrived a millisecond later, and the answer is this computer's own database.
   */
  async function learnPlaylistOwners(rows: PlaylistSummary[]) {
    const authors = [...new Set(rows.map((row) => row.author).filter(Boolean))];
    const known = [...new Set([...authors, playlistAuthor].filter(Boolean))];
    if (!known.length) return;
    try {
      const labels = await invoke<PubkeyLabel[]>('pubkey_labels', { pubkeys: known });
      playlistOwners = new Map(
        labels.map((label) => [label.pubkey, label.name?.trim() || label.npub || label.pubkey])
      );
    } catch {
      // A name is decoration: a list that cannot be named is still a list.
    }
  }

  /**
   * Which refresh the page is waiting for.
   *
   * A refresh that is overtaken by a newer one must not write its answer over
   * it. The page asks whenever it is opened and whenever Refresh is pressed, so
   * two can be in flight at once, and an older answer landing last would label
   * the rows from a look that has already been replaced - which is the one
   * thing the reconciliation must never get wrong.
   */
  let playlistRefresh = 0;

  async function refreshPlaylists() {
    const attempt = ++playlistRefresh;
    playlistsLoading = true;
    playlistsError = '';
    try {
      if (!playlistAuthor) playlistAuthor = await invoke<string>('own_playlist_author');
      // Looking at the relays is best effort: playlists are edited offline as
      // often as not, and this computer's own rows are listed either way. A look
      // that fails leaves the reconciliation exactly where it was.
      if (networkConnected) {
        try {
          await invoke<PlaylistReadReport>('read_playlists');
        } catch {
          // The read is what tells "the relays do not have this" apart from
          // "nobody looked"; when it cannot happen, the answer below stays null.
        }
      }
      const rows = await invoke<PlaylistSummary[]>('playlists');
      const relays = await invoke<PlaylistSummary[] | null>('playlist_reconciliation');
      // Names before rows: the list is drawn once, already saying who owns what.
      await learnPlaylistOwners([...rows, ...(relays ?? [])]);
      if (attempt !== playlistRefresh) return;
      playlists = rows;
      playlistRelays = relays;
      void primePlaylistArt([...rows, ...(relays ?? [])]);
    } catch (error) {
      if (attempt === playlistRefresh) playlistsError = String(error);
    } finally {
      if (attempt === playlistRefresh) playlistsLoading = false;
    }
  }

  /**
   * Bring one of your own playlists back from the relays.
   *
   * The relays hold the revision, so this is an import rather than a publish,
   * and it is the author's decision: an installation that restored everything it
   * found would be treating the relays as the truth about what this computer
   * holds, which is the same mistake as withdrawing everything they lack.
   */
  async function restorePlaylist(row: PlaylistRow) {
    playlistSaving = true;
    playlistsError = '';
    try {
      await invoke('restore_playlist', { playlistId: row.playlistId });
      await refreshPlaylists();
    } catch (error) {
      playlistsError = String(error);
    } finally {
      playlistSaving = false;
    }
  }

  /**
   * How many live seeders each member of an open playlist has.
   *
   * A playlist asserts nothing about who holds its members, so this comes from
   * the ordinary kind 30422 heartbeats, from any author. It is decoration: a
   * member nobody seeds is still drawn, because its position is part of what the
   * playlist means - so a relay that cannot answer costs the badges and nothing
   * else.
   */
  async function loadPlaylistAvailability(detail: PlaylistDetail) {
    playlistAvailability = new Map();
    if (!networkConnected || detail.tracks.length === 0) return;
    try {
      const rows = await invoke<PlaylistMemberAvailability[]>('playlist_member_availability', {
        fileIds: detail.tracks.map((member) => member.fileId)
      });
      playlistAvailability = new Map(rows.map((row) => [row.fileId, row.seeders]));
    } catch {
      // The members are shown from the playlist's own description instead.
    }
  }

  /**
   * What a member row says about who holds the file right now, or an empty
   * string while nothing is known about it.
   *
   * A playlist is curation: it need not be held by its author, by this computer,
   * or by anybody at all, so a member row answers with what is actually out
   * there rather than with what the playlist claims. An unavailable member is
   * drawn like every other member - its position is part of what the playlist
   * means - which is why this says so instead of dropping the row.
   */
  function memberAvailability(fileId: string, counts: Map<string, number>, local: Set<string>) {
    if (local.has(fileId)) return $t("This computer");
    if (!counts.has(fileId)) return '';
    const seeders = counts.get(fileId) ?? 0;
    if (seeders === 0) return $t("Unavailable");
    return `${seeders} ${$t(seeders === 1 ? "seeder" : "seeders")}`;
  }

  /**
   * Whether a row is this computer's own playlist.
   *
   * Two things make a row this identity's: an author it holds the key for, and
   * an empty author, which is a playlist only this computer has ever written
   * down. A row that arrived from a relay with somebody else's author is theirs,
   * and everything this page does with one of those is read-only - saving it
   * makes a copy under an id of its own rather than a revision of their
   * coordinate. Refusing to edit a playlist because the identity could not be
   * read would be worse than the mistake it guards against.
   */
  function playlistIsMine(author: string) {
    return !author || !playlistAuthor || author === playlistAuthor;
  }

  /** A playlist that has not been written down yet, with an id to write it under. */
  async function newPlaylist() {
    playlistsError = '';
    try {
      playlistDraft = {
        playlistId: await invoke<string>('new_playlist_id'),
        title: '',
        author: playlistAuthor,
        displayName,
        artist: '',
        mbid: '',
        image: '',
        tags: '',
        private: false,
        published: false,
        updatedAt: 0,
        tracks: [],
        total: 0
      };
      playlistEditing = true;
      selectedPlaylistKey = '';
      playlistMembers = [];
      playlistCandidates = [];
      playlistCandidateQuery = '';
      playlistSuggestTags = true;
      playlistError = '';
      playlistNotice = '';
    } catch (error) {
      playlistsError = String(error);
    }
  }

  async function openPlaylist(summary: PlaylistSummary) {
    playlistsError = '';
    try {
      const loaded = await invoke<PlaylistDetail | null>('playlist', {
        author: summary.author,
        playlistId: summary.playlistId
      });
      if (!loaded) {
        playlistsError = msg("That playlist is not on this computer");
        return;
      }
      playlistDraft = loaded;
      playlistEditing = false;
      selectedPlaylistKey = `${summary.author} ${summary.playlistId}`;
      playlistMembers = [...loaded.tracks];
      playlistCandidates = [];
      playlistCandidateQuery = '';
      // A playlist that already carries words of its own has already answered
      // the suggestion question, and re-asking would put our words back.
      playlistSuggestTags = loaded.tags.trim() === '';
      playlistError = '';
      playlistNotice = '';
      const artful = loaded.tracks.find((track) => track.artist && track.album);
      if (artful && !playlistArt.has(selectedPlaylistKey)) {
        playlistArt = new Map(playlistArt).set(selectedPlaylistKey, { artist: artful.artist, album: artful.album });
      }
      void loadPlaylistAvailability(loaded);
    } catch (error) {
      playlistsError = String(error);
    }
  }

  function playlistKey(row: PlaylistSummary) { return `${row.author} ${row.playlistId}`; }
  function playlistArtOf(row: PlaylistSummary) { return playlistArt.get(playlistKey(row)) ?? null; }

  /** The first member of what is on screen with art, which is what the tile shows. */
  $: selectedPlaylistArt = playlistMembers.find((track) => track.artist && track.album) ?? null;
  $: playlistHasLocalTracks = playlistMembers.some((member) => localFileIds.has(member.fileId));

  function setPlaylistView(view: 'list' | 'grid') {
    playlistView = view;
    try { window.localStorage.setItem('deadwax-playlist-view', view); } catch { /* a blocked store only forgets the choice */ }
  }

  /**
   * Give every tile its picture, one playlist at a time.
   *
   * A summary has no artist or album on it - the wire carries only the first file
   * id - so the tile's art has to come from reading the playlist. Bounded, because
   * a library of a hundred playlists should not be a hundred reads on the way in;
   * a tile that has not been reached yet draws a note instead of nothing.
   */
  async function primePlaylistArt(rows: PlaylistSummary[]) {
    const wanted = rows.filter((row) => !playlistArt.has(playlistKey(row))).slice(0, 24);
    for (const row of wanted) {
      try {
        const loaded = await invoke<PlaylistDetail | null>('playlist', { author: row.author, playlistId: row.playlistId });
        const artful = loaded?.tracks.find((track) => track.artist && track.album);
        if (artful) playlistArt = new Map(playlistArt).set(playlistKey(row), { artist: artful.artist, album: artful.album });
      } catch { /* a tile without art still has a name */ }
    }
  }

  /** Play the members this computer holds, in the playlist's own order. */
  async function playPlaylist() {
    const order = playlistMembers
      .map((member) => sharedFiles.find((file) => file.fileId === member.fileId))
      .filter((file) => Boolean(file))
      .map((file) => toPlayerTrack(file!));
    if (!order.length) {
      activityMessage = msg("None of this playlist is on this computer yet");
      return;
    }
    activePlayerAudiobook = null;
    playerOrigin = 'direct';
    playerQueueRemote = false;
    if (order.length > 1 && playerMode === 'single') {
      playerMode = 'all';
      window.localStorage.setItem('napstr-player-mode', playerMode);
    }
    playerQueueOrder = order;
    playerQueue = playerShuffle ? shuffledQueue(order, order[0].fileId) : order;
    await loadPlayerTrack(Math.max(0, playerQueue.findIndex((item) => item.fileId === order[0].fileId)));
  }

  function closePlaylistEditor() {
    playlistEditing = false;
    playlistDraft = null;
    selectedPlaylistKey = '';
    playlistMembers = [];
    playlistCandidates = [];
    playlistCandidateQuery = '';
    playlistAvailability = new Map();
    playlistError = '';
    playlistNotice = '';
  }

  function addPlaylistMember(candidate: PlaylistCandidate) {
    if (playlistMembers.some((member) => member.fileId === candidate.fileId)) return;
    playlistMembers = [
      ...playlistMembers,
      {
        position: playlistMembers.length + 1,
        fileId: candidate.fileId,
        // The playlist's own description of the track, which is all there is to
        // go on when the file is not here: a hint, always, and one a catalogue
        // entry overrides the moment there is one.
        title: candidate.title || candidate.filename,
        artist: candidate.artist,
        album: candidate.album
      }
    ];
  }

  /** Forget the picture a playlist names. The file itself is not touched. */
  function clearPlaylistImage() {
    if (playlistDraft) playlistDraft = { ...playlistDraft, image: '' };
  }

  function removePlaylistMember(index: number) {
    playlistMembers = playlistMembers.filter((_, position) => position !== index);
  }

  /**
   * Which member is being dragged, and where it would land.
   *
   * The order of a playlist is the point of a playlist, and two arrow buttons
   * moved a track one place at a time. A drag says where it goes in one gesture;
   * the grip is the only thing that starts one, so a row can still be clicked to
   * open it.
   */
  let playlistDragIndex = -1;
  let playlistDropIndex = -1;

  function beginPlaylistDrag(index: number, event: DragEvent) {
    if (!playlistDraftIsMine) return;
    playlistDragIndex = index;
    playlistDropIndex = index;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      // Firefox will not start a drag without data; the payload is never read.
      event.dataTransfer.setData('text/plain', String(index));
    }
  }

  function overPlaylistMember(index: number, event: DragEvent) {
    if (playlistDragIndex < 0) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    playlistDropIndex = index;
  }

  function dropPlaylistMember(index: number) {
    if (playlistDragIndex >= 0 && playlistDragIndex !== index) {
      const moved = [...playlistMembers];
      const [member] = moved.splice(playlistDragIndex, 1);
      moved.splice(index, 0, member);
      playlistMembers = moved;
    }
    playlistDragIndex = -1;
    playlistDropIndex = -1;
  }

  function endPlaylistDrag() {
    playlistDragIndex = -1;
    playlistDropIndex = -1;
  }

  function movePlaylistMember(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= playlistMembers.length) return;
    const moved = [...playlistMembers];
    const [member] = moved.splice(index, 1);
    moved.splice(target, 0, member);
    playlistMembers = moved;
  }

  /** The draft as the host stores it: positions are the order on screen. */
  function playlistForHost(): PlaylistDetail {
    const tracks = playlistMembers.map((member, index) => ({ ...member, position: index + 1 }));
    return { ...(playlistDraft as PlaylistDetail), tracks, total: tracks.length };
  }

  /**
   * Find tracks to add: here first, then on the network.
   *
   * Searching only this computer would make the ordinary case impossible — a
   * person listing music they have not listened to here yet — so a network row
   * is offered the same way a local one is, and marked, because adding it means
   * the playlist names a file before this computer holds it. That is allowed,
   * and the member reads from the playlist's own description until it arrives.
   */
  async function searchPlaylistTracks() {
    playlistSearching = true;
    playlistError = '';
    const query = playlistCandidateQuery.trim();
    try {
      const here = await invoke<NativeFile[]>('search_catalog', { query });
      const found: PlaylistCandidate[] = here.map((file) => ({
        fileId: file.fileId,
        title: file.title,
        artist: file.artist,
        album: file.album,
        filename: file.filename,
        source: 'local' as const
      }));
      if (networkConnected) {
        try {
          const remote = await invoke<NetworkResult[]>('network_search', { query });
          for (const result of remote) {
            if (found.some((candidate) => candidate.fileId === result.fileId)) continue;
            found.push({
              fileId: result.fileId,
              title: result.title,
              artist: result.artist,
              album: result.album,
              filename: result.filename,
              source: 'network' as const
            });
          }
        } catch {
          // A playlist is edited offline as often as not. A network that cannot
          // answer is not a failure of the search: it leaves the local rows.
        }
      }
      playlistCandidates = found;
    } catch (error) {
      playlistError = String(error);
    } finally {
      playlistSearching = false;
    }
  }

  /** Write the draft down here. Editing is local until the author publishes. */
  async function savePlaylist() {
    if (!playlistDraft) return false;
    playlistSaving = true;
    playlistError = '';
    playlistNotice = '';
    try {
      // A playlist somebody else wrote is filed as a copy with an id of its
      // own, which is what comes back here - so the editor carries on with the
      // copy rather than with their coordinate.
      const copied = !playlistIsMine(playlistDraft.author);
      playlistDraft = await invoke<PlaylistDetail>('save_playlist', { playlist: playlistForHost() });
      playlistMembers = [...playlistDraft.tracks];
      playlistNotice = msg("Saved on this computer");
      await refreshPlaylists();
      if (copied) await loadPlaylistAvailability(playlistDraft);
      return true;
    } catch (error) {
      playlistError = String(error);
      return false;
    } finally {
      playlistSaving = false;
    }
  }

  async function publishPlaylist() {
    if (!playlistDraft) return;
    if (!(await savePlaylist())) return;
    playlistSaving = true;
    playlistError = '';
    try {
      playlistDraft = await invoke<PlaylistDetail>('publish_playlist', {
        playlist: playlistForHost(),
        suggestTags: playlistSuggestTags
      });
      playlistMembers = [...playlistDraft.tracks];
      playlistNotice = msg("Published to the relays");
      await refreshPlaylists();
    } catch (error) {
      playlistError = String(error);
    } finally {
      playlistSaving = false;
    }
  }

  /**
   * Get rid of a playlist.
   *
   * A playlist the relays have seen is withdrawn rather than forgotten: deleting
   * it here alone would leave the published revision standing, and the next
   * client to look would find a playlist its author believes they threw away.
   * A row this computer does not own is nobody's to delete here - the host
   * refuses to withdraw a coordinate it does not hold, and a playlist that
   * arrived from a relay would simply come back on the next look.
   */
  async function deletePlaylist(playlist: PlaylistDetail | PlaylistSummary | null) {
    if (!playlist) return;
    // Withdrawing is not like forgetting: the relays are told, and the playlist
    // is gone for everyone who reads it. It is the author's decision, so it is
    // asked for rather than assumed - which is the whole point of keeping the
    // reconciliation away from anything automatic.
    if (
      playlist.published &&
      !window.confirm($t("This is published, so it will be withdrawn from the relays as well."))
    ) {
      return;
    }
    playlistSaving = true;
    playlistError = '';
    try {
      if (playlist.published) await invoke('withdraw_playlist', { playlistId: playlist.playlistId });
      else await invoke('delete_playlist', { author: playlist.author, playlistId: playlist.playlistId });
      if (playlistDraft && playlistDraft.playlistId === playlist.playlistId) closePlaylistEditor();
      await refreshPlaylists();
    } catch (error) {
      playlistError = String(error);
    } finally {
      playlistSaving = false;
    }
  }

  function activateView(view: View) {
    activeView = view;
    if (view === 'Trollbox') void refreshTrollbox();
    if (view === 'Clients') void openMobileConnect();
    if (view === 'Covers') void refreshCovers();
    if (view === 'Playlists') void refreshPlaylists();
    if (view === 'Network') void refreshCatalogueStats();
    if (view === 'Settings') void refreshCoverStatus();
  }

  async function openMobileConnect() {
    await refreshMobileStatus();
    // One code, low privilege. The full-access offer was two doors into the same
    // room and the one people picked by accident was the wide one.
    if (!mobileStreamPairing) await createMobilePairing(true);
  }

  async function refreshMobileStatus() {
    if (!nativeReady || mobileStatusPending) return;
    mobileStatusPending = true;
    try {
      mobileStatusValue = await invoke<MobileStatus>('mobile_status');
      mobileError = mobileStatusValue.error;
    } catch (error) {
      mobileError = String(error);
    } finally {
      mobileStatusPending = false;
    }
  }

  /**
   * The numbers behind the Network page.
   *
   * Read when the page is opened or asked to refresh, never on a timer: the
   * queries walk the whole mirror, and to somebody reading the page a catalogue
   * a minute old looks exactly like one a second old.
   */
  async function refreshCatalogueStats() {
    if (!nativeReady || catalogueStatsPending) return;
    catalogueStatsPending = true;
    catalogueStatsError = '';
    try {
      catalogueStats = await invoke<CatalogueStats>('catalogue_status');
    } catch (error) {
      catalogueStatsError = String(error);
    } finally {
      catalogueStatsPending = false;
    }
    await refreshSeeders();
  }

  /**
   * The seeder list is paged, because the mirror knows hundreds of peers and the
   * card has room for a dozen. Quiet peers - the ones whose heartbeat has
   * expired, so they announced once and hold nothing now - are hidden until the
   * switch is turned on, which is what makes the first page worth reading.
   */
  async function refreshSeeders() {
    if (!nativeReady || seedersPending) return;
    seedersPending = true;
    try {
      seedersPage = await invoke<SeederPage>('catalogue_seeders', {
        offset: seederPageIndex * SEEDER_PAGE_SIZE,
        limit: SEEDER_PAGE_SIZE,
        hideQuiet: !showQuietSeeders,
      });
    } catch (error) {
      seederError = String(error);
    } finally {
      seedersPending = false;
    }
  }

  function changeSeederPage(page: number) {
    const next = Math.max(0, page);
    if (next === seederPageIndex) return;
    seederPageIndex = next;
    void refreshSeeders();
  }

  /** A peer's kind-0 name, or the npub when nobody has published one. */
  function seederLabel(row: SeederRow) {
    return row.name || shortKey(row.npub || row.pubkey);
  }

  const countFormat = new Intl.NumberFormat();
  function counted(value: number) { return countFormat.format(value); }
  function shortKey(pubkey: string) { return `${pubkey.slice(0, 10)}…${pubkey.slice(-4)}`; }
  /**
   * When the mirror last wrote an announcement down. This is a fact about *this*
   * computer, not about the network — an announcement written an hour ago can
   * describe something published a minute ago — so it is labelled as the mirror's
   * own clock rather than as when the network last spoke.
   */
  function mirrorWritten(written: string) {
    const then = Date.parse(written);
    return Number.isFinite(then) ? new Date(then).toLocaleString($locale, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  }

  async function createMobilePairing(streamOnly = false) {
    if (!nativeReady || mobileLoading) return;
    mobileLoading = true;
    mobileError = '';
    try {
      const offer = await invoke<MobilePairingOffer>('create_mobile_pairing', { rights: streamOnly ? READ_ONLY_RIGHTS : FULL_RIGHTS });
      if (streamOnly) mobileStreamPairing = offer;
      await refreshMobileStatus();
    } catch (error) {
      mobileError = String(error);
    } finally {
      mobileLoading = false;
    }
  }

  /**
   * What a pairing code hands over, in the two sizes the picker offers.
   *
   * A code is an invitation now rather than a permanent grant: it says what the
   * device may do *to begin with*, and every one of those rights can be changed
   * afterwards from the list below, so a misjudged code is no longer a reason to
   * pair again.
   */
  const READ_ONLY_RIGHTS: DeviceRights = { browse: true, fetch: true, control: false, download: false, privileged: false };
  const FULL_RIGHTS: DeviceRights = { browse: true, fetch: true, control: true, download: true, privileged: true };

  /**
   * The five rights, in the order they build on each other.
   *
   * `download` sits between driving the computer and acting as its owner: it is
   * reaching the network through this computer - searching the relays, reading
   * its catalogue mirror, and telling it to fetch a file - which changes nothing
   * anybody can see under the user's name. `privileged` is the signature, and a
   * grant that has it still has downloads, because that is what it meant before
   * the two were separated.
   */
  function deviceRightChoices(): { key: keyof DeviceRights; label: string }[] {
    return [
      { key: 'browse', label: $t("Read the library") },
      { key: 'fetch', label: $t("Play and keep audio") },
      { key: 'control', label: $t("Control playback") },
      { key: 'download', label: $t("Download from the network") },
      { key: 'privileged', label: $t("Sign and publish as you") }
    ];
  }

  /**
   * Change one right on one device, and ask again rather than guessing.
   *
   * The write goes to the host, which refuses a device it never paired with, so
   * a failure here means the list on screen was stale instead of the tick being
   * wrong - and the refresh shows what is actually true.
   */
  async function setDeviceRight(device: MobileDevice, key: keyof DeviceRights, allowed: boolean) {
    if (mobileLoading) return;
    mobileLoading = true;
    mobileError = '';
    try {
      await invoke('set_mobile_device_rights', {
        endpointId: device.endpointId,
        rights: { ...device.rights, [key]: allowed }
      });
      await refreshMobileStatus();
    } catch (error) {
      mobileError = String(error);
    } finally {
      mobileLoading = false;
    }
  }

  async function revokeMobileDevice(device: MobileDevice) {
    if (!window.confirm($t("Remove {p0}? It will need a new QR code before it can connect again.", { p0: device.name }))) return;
    try {
      await invoke('revoke_mobile_device', { endpointId: device.endpointId });
      await refreshMobileStatus();
    } catch (error) {
      mobileError = String(error);
    }
  }

  /**
   * Save one client's likes and dislikes to a file the person chooses.
   *
   * The lists are what a client built up on this computer, so they are the part
   * worth carrying to a new install; the pairing and the rights are not, because
   * restoring a file must not be a way of letting a client back in.
   */
  async function backupClientData(device: MobileDevice) {
    if (mobileLoading) return;
    mobileError = '';
    clientNote = '';
    try {
      const chosen = await save({
        title: $t("Save {p0}’s marks", { p0: device.name }),
        defaultPath: `${device.name.replace(/[^a-z0-9 _.-]/gi, '') || 'client'}-deadwax-backup.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });
      if (!chosen) return;
      mobileLoading = true;
      const written = await invoke<{ likes: string[]; dislikes: string[]; playlists: unknown[] }>('export_client_data', {
        endpointId: device.endpointId,
        path: chosen
      });
      clientNote = $t("Saved {p0} likes, {p1} dislikes and {p2} playlists for {p3}.", {
        p0: written.likes.length,
        p1: written.dislikes.length,
        p2: written.playlists.length,
        p3: device.name
      });
      await refreshMobileStatus();
    } catch (error) {
      mobileError = String(error);
    } finally {
      mobileLoading = false;
    }
  }

  /** Put those lists back, from a file the person chooses. */
  async function restoreClientData(device: MobileDevice) {
    if (mobileLoading) return;
    mobileError = '';
    clientNote = '';
    try {
      const chosen = await open({
        title: $t("Choose {p0}’s backup", { p0: device.name }),
        multiple: false,
        directory: false,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });
      if (!chosen || Array.isArray(chosen)) return;
      mobileLoading = true;
      const restored = await invoke<{ likes: string[]; dislikes: string[]; playlists: unknown[] }>('import_client_data', {
        endpointId: device.endpointId,
        path: chosen
      });
      clientNote = $t("Restored {p0} likes, {p1} dislikes and {p2} playlists for {p3}.", {
        p0: restored.likes.length,
        p1: restored.dislikes.length,
        p2: restored.playlists.length,
        p3: device.name
      });
      await refreshMobileStatus();
    } catch (error) {
      mobileError = String(error);
    } finally {
      mobileLoading = false;
    }
  }

  function mobileLastSeen(value: string) {
    const time = Date.parse(value);
    if (!Number.isFinite(time)) return $t("Never");
    const elapsed = Math.max(0, Date.now() - time);
    if (elapsed < 90_000) return $t("Just now");
    if (elapsed < 3_600_000) return $t("{p0} min ago", { p0: Math.floor(elapsed / 60_000) });
    if (elapsed < 86_400_000) return $t("{p0} hr ago", { p0: Math.floor(elapsed / 3_600_000) });
    return new Date(time).toLocaleDateString($locale);
  }

  async function sendTrollboxMessage() {
    const content = trollboxDraft.trim();
    if (!content || trollboxSending || !networkConnected) return;
    trollboxSending = true;
    trollboxError = '';
    try {
      await invoke('send_trollbox_message', { content });
      trollboxDraft = '';
      await refreshTrollbox();
    } catch (error) {
      trollboxError = String(error);
    } finally {
      trollboxSending = false;
    }
  }

  function blockTrollboxUser(message: TrollboxMessage) {
    if (!nativeReady || message.npub === identityNpub) return;
    blockConfirmation = { kind: 'user', pubkey: message.pubkey, label: message.displayName };
  }

  function selectResult(item: Result | null, forceSubscribe = false, preserveSelection = false) {
    if (!preserveSelection) {
      selectedResultIds = new Set(item ? [item.fileId] : []);
      resultSelectionAnchor = item?.fileId ?? null;
    }
    const changed = selected?.fileId !== item?.fileId;
    selected = item;
    if (changed || !preserveSelection) selectedSource = 0;
    if (!item || item.audiobook) {
      trackDiscussionGeneration += 1;
      trackDiscussionFileId = '';
      trackDiscussionMessages = [];
      trackDiscussionDraft = '';
      trackDiscussionError = '';
    } else if (changed || forceSubscribe) {
      void refreshTrackDiscussion(item.fileId, true);
    }
  }

  function selectResultRange(item: Result, event: MouseEvent | KeyboardEvent) {
    const anchor = results.findIndex((result) => result.fileId === resultSelectionAnchor);
    const end = results.findIndex((result) => result.fileId === item.fileId);
    if (event.shiftKey && anchor >= 0 && end >= 0) {
      selectedResultIds = new Set(results.slice(Math.min(anchor, end), Math.max(anchor, end) + 1).map((result) => result.fileId));
      selectResult(item, false, true);
    } else {
      selectResult(item);
    }
  }

  function reconcileResultSelection(forceSubscribe = false) {
    const remaining = results.filter((item) => selectedResultIds.has(item.fileId));
    const next = remaining.find((item) => item.fileId === selected?.fileId) ?? remaining[0] ?? paginatedResults(results, resultPage)[0] ?? null;
    selectedResultIds = new Set(remaining.length ? remaining.map((item) => item.fileId) : next ? [next.fileId] : []);
    if (!results.some((item) => item.fileId === resultSelectionAnchor)) resultSelectionAnchor = next?.fileId ?? null;
    selectResult(next, forceSubscribe, true);
  }

  function selectedResults() {
    return results.filter((item) => selectedResultIds.has(item.fileId));
  }

  function canDownloadResult(item: Result) {
    if (item.audiobook) {
      return !item.audiobook.chapters.every((chapter) => isLocalFile(chapter.fileId))
        && item.audiobook.sources.length > 0
        && !audiobookDownloads.some((download) => download.audiobookId === item.audiobook?.audiobookId);
    }
    return !isLocalFile(item.fileId) && Boolean(item.sourceDetails?.length)
      && !startingDownloads.has(item.fileId)
      && !transfers.some((transfer) => transfer.fileId === item.fileId && isActiveTransfer(transfer));
  }

  async function downloadSelectedResults() {
    if (!nativeReady || downloadingSelection || clearingTransfers) return;
    const generation = downloadGeneration;
    const targets = selectedResults();
    downloadingSelection = true;
    let requested = 0;
    let skipped = 0;
    let failed = 0;
    try {
      // Submit the entire selection immediately. The native queue owns the
      // two-track limit; a slow request or UI refresh must not block enqueueing.
      await Promise.all(targets.map(async (target) => {
        if (generation !== downloadGeneration) return;
        if (!canDownloadResult(target)) { skipped += 1; return; }
        try {
          if (await startDownload(target)) requested += 1;
          else failed += 1;
        } catch { failed += 1; }
      }));
      if (generation === downloadGeneration) activityMessage = msg("Downloads requested: {requested} · Skipped: {skipped} · Failed: {failed}", { requested, skipped, failed });
    } finally {
      downloadingSelection = false;
    }
  }

  async function refreshTrackDiscussion(fileId = selected?.fileId ?? '', subscribe = false, older = false) {
    if (!fileId || !nativeReady || !networkConnected) return;
    if (trackDiscussionFileId !== fileId) {
      trackDiscussionGeneration += 1;
      trackDiscussionFileId = fileId;
      trackDiscussionMessages = [];
      trackDiscussionDraft = '';
      trackDiscussionError = '';
      trackDiscussionHasMore = true;
      trackDiscussionPollPending = false;
      trackDiscussionRefreshAgain = false;
      trackDiscussionSubscribeAgain = false;
      subscribe = true;
    }
    if (older && (!trackDiscussionHasMore || !trackDiscussionMessages.length)) return;
    if (trackDiscussionPollPending) {
      if (!older) trackDiscussionRefreshAgain = true;
      if (subscribe) trackDiscussionSubscribeAgain = true;
      return;
    }
    const generation = trackDiscussionGeneration;
    trackDiscussionPollPending = true;
    const initial = trackDiscussionMessages.length === 0;
    trackDiscussionLoading = initial || older;
    const first = trackDiscussionMessages[0];
    try {
      const messages = await invoke<TrollboxMessage[]>('get_track_discussion_messages', {
        fileId, subscribe, before: older ? { createdAt: first.createdAt, eventId: first.eventId } : null
      });
      if (generation !== trackDiscussionGeneration || selected?.fileId !== fileId) return;
      const restoreScroll = chatScrollRestorer(trackDiscussionLog, initial, older);
      trackDiscussionMessages = mergeChatMessages(trackDiscussionMessages, messages);
      if (older) trackDiscussionHasMore = messages.length === CHAT_PAGE_SIZE;
      trackDiscussionError = '';
      trackDiscussionLoading = false;
      await tick();
      if (generation === trackDiscussionGeneration) restoreScroll();
    } catch (error) {
      if (generation === trackDiscussionGeneration) trackDiscussionError = String(error);
    } finally {
      if (generation === trackDiscussionGeneration) {
        trackDiscussionLoading = false;
        trackDiscussionPollPending = false;
        if (trackDiscussionRefreshAgain) {
          const subscribeAgain = trackDiscussionSubscribeAgain;
          trackDiscussionRefreshAgain = false;
          trackDiscussionSubscribeAgain = false;
          void refreshTrackDiscussion(fileId, subscribeAgain);
        }
      }
    }
  }

  /**
   * Asks how much conversation the rows on screen have attracted.
   *
   * One read for the page, for files nobody has asked about yet, and no polling:
   * a mark that is a few minutes stale is worth far more than a relay being asked
   * about the same rows every time a page is turned. A file the host holds and has
   * not published is left out of the question by the host itself, because asking
   * a relay about those bytes would say what this computer has.
   */
  async function refreshDiscussionActivity(fileIds: string[]) {
    const wanted = fileIds.filter((fileId) => !discussionAsked.has(fileId));
    if (!wanted.length) return;
    for (const fileId of wanted) discussionAsked.add(fileId);
    try {
      const rows = await invoke<TrackDiscussionActivity[]>('track_discussion_activity', { fileIds: wanted });
      if (!rows.length) return;
      discussionActivity = {
        ...discussionActivity,
        ...Object.fromEntries(rows.map((row) => [row.fileId, row]))
      };
    } catch {
      // A mark is a courtesy. A relay that does not answer leaves the rows quiet,
      // and the panel beside them is where the discussion itself is read.
    }
  }

  /**
   * How many people have commented, in words, for the mark that shows a number.
   *
   * The template reads `discussionActivity` itself rather than asking a helper
   * for it: Svelte follows the variables an expression names, not the ones a
   * function it calls happens to read, so a mark drawn through a helper would
   * never appear when the answer arrived.
   */
  function discussionMarkLabel(activity: TrackDiscussionActivity) {
    return activity.authors === 1
      ? $t("One person commented in the last 30 days")
      : $t("{p0} people commented in the last 30 days", { p0: activity.authors });
  }

  async function sendTrackDiscussionMessage() {
    const fileId = selected?.fileId;
    const content = trackDiscussionDraft.trim();
    if (!fileId || !content || trackDiscussionSending || !networkConnected) return;
    trackDiscussionSending = true;
    trackDiscussionError = '';
    try {
      await invoke('send_track_discussion_message', { fileId, content });
      if (selected?.fileId !== fileId) return;
      trackDiscussionDraft = '';
      await refreshTrackDiscussion(fileId);
    } catch (error) {
      if (selected?.fileId === fileId) trackDiscussionError = String(error);
    } finally {
      trackDiscussionSending = false;
    }
  }

  async function refreshLocalLibrary() {
    try {
      const snapshot = await invoke<Snapshot>('get_snapshot');
      indexedBytes = snapshot.indexedBytes;
      localAudiobooks = snapshot.audiobooks;
      const nextFiles = snapshot.files.map((file) => ({ ...file, name: file.filename, readableSize: readableSize(file.size), peers: 0 }));
      const removedCurrentTrack = currentTrack && !nextFiles.some((file) => file.fileId === currentTrack?.fileId);
      sharedFiles = nextFiles;
      localFileIds = new Set(nextFiles.map((file) => file.fileId));
      sharedLibraryPage = Math.min(sharedLibraryPage, localPageCount(visibleSharedFiles()) - 1);
      if (selectedShared) selectedShared = nextFiles.find((file) => file.fileId === selectedShared?.fileId) ?? null;
      if (selectedTagFile && !nextFiles.some((file) => file.fileId === selectedTagFile?.fileId)) {
        selectedTagFile = null;
        tagDraft = '';
      }
      if (removedCurrentTrack) {
        invoke<PlaybackStatus>('stop_audio').catch(() => {});
        currentTrack = null;
        playerQueue = [];
        playerQueueIndex = -1;
        playerPlaying = false;
        playerLoading = false;
        playerCurrentTime = 0;
        playerDuration = 0;
        activityMessage = msg("Stopped playback because the file was removed from the Deadwax folder");
      } else if (currentTrack) {
        playerQueue = queueForTrack(currentTrack, playerMode);
        playerQueueIndex = playerQueue.findIndex((item) => item.fileId === currentTrack?.fileId);
      }
      syncResultLocality();
      return true;
    } catch { return false; /* the next folder-watch or transfer poll will retry */ }
  }

  function mergeIndexBatch(batch: IndexBatch) {
    const merged = new Map(sharedFiles.map((file) => [file.fileId, file]));
    for (const file of batch.files) {
      merged.set(file.fileId, {
        ...file,
        name: file.filename,
        readableSize: readableSize(file.size),
        peers: merged.get(file.fileId)?.peers ?? 0
      });
    }
    sharedFiles = [...merged.values()].sort((left, right) => left.filename.localeCompare(right.filename));
    localFileIds = new Set(sharedFiles.map((file) => file.fileId));
    indexedBytes = sharedFiles.reduce((total, file) => total + file.size, 0);
    if (selectedShared) selectedShared = merged.get(selectedShared.fileId) ?? selectedShared;
    if (selectedTagFile) selectedTagFile = merged.get(selectedTagFile.fileId) ?? selectedTagFile;
    if (currentTrack) {
      playerQueue = queueForTrack(currentTrack, playerMode);
      playerQueueIndex = playerQueue.findIndex((item) => item.fileId === currentTrack?.fileId);
    }
    syncResultLocality();
  }

  async function connectNetwork() {
    if (!nativeReady || networkConnectPending) return;
    networkConnectPending = true;
    activityMessage = msg("Connecting to Nostr relays and opening encrypted inbox…");
    try {
      const status = await invoke<NetworkStatus>('start_network');
      applyNetworkStatus(status);
      activityMessage = msg("Nostr connected · loading the most available audio from {p0} relays…", { p0: status.relayCount });
      await search();
      if (status.torError) activityMessage = msg("Tor failed: {p0} · click the connection panel to retry", { p0: status.torError });
    } catch (error) {
      networkConnected = false;
      networkError = String(error);
      activityMessage = msg("Network unavailable: {p0}", { p0: String(error) });
    } finally {
      networkConnectPending = false;
    }
  }

  function applyNetworkStatus(status: NetworkStatus) {
    networkConnected = status.connected;
    torRunning = status.torRunning;
    torStarting = status.torStarting;
    torProgress = status.torProgress;
    torError = status.torError;
    identityNpub = status.npub;
    networkError = status.error;
  }

  async function recoverAfterSleep() {
    if (!nativeReady) return;
    networkConnected = false;
    torRunning = false;
    torStarting = true;
    torProgress = 0;
    playerPlaying = false;
    playerLoading = false;
    playerCurrentTime = 0;
    playerEnded = currentTrack !== null;
    lastPlayerError = '';
    activityMessage = msg("Computer resumed · reconnecting Nostr, Tor, and audio…");
    try {
      await invoke('recover_after_sleep');
    } catch (error) {
      activityMessage = msg("Resume recovery failed: {p0} · click the connection panel to retry", { p0: String(error) });
    }
  }

  function torStatusLabel() {
    if (torRunning) return 'Tor connected';
    if (torError) return 'Tor failed';
    if (torStarting && torProgress > 0) return $t("Tor connecting {p0}%", { p0: torProgress });
    return nativeReady ? 'Tor connecting' : 'Tor unavailable';
  }

  async function browseUser(user: CatalogueUser) {
    activeView = 'Search';
    sourceProfile = null;
    query = user.displayName;
    searchUser = user;
    format = 'Audio only';
    minimumSources = 1;
    maximumSize = '';
    await search(true);
  }

  function ownCatalogueUser(): CatalogueUser {
    return { pubkey: identityNpub, npub: identityNpub, displayName };
  }

  function knownUsersNamed(value: string): CatalogueUser[] {
    const name = value.trim().toLocaleLowerCase();
    const users: CatalogueUser[] = [
      ...results.flatMap((item) => item.sourceDetails ?? []),
      ...trollboxMessages, ...trackDiscussionMessages, ownCatalogueUser()
    ];
    return users.filter((user) => user.npub && user.displayName.trim().toLocaleLowerCase() === name);
  }

  async function search(replacePending = false) {
    if (searchAction && !replacePending) return;
    const generation = ++browseGeneration;
    browseCursor = null;
    browseLoading = false;
    loadedNetworkMatches = [];
    loadedNetworkAudiobooks = [];
    browseTotalAvailable = 0;
    searchAction = 'search';
    resultUser = null;
    matchingUsers = [];
    try {
      const trimmedQuery = query.trim();
      let user = searchUser && [searchUser.displayName, searchUser.npub, searchUser.pubkey].some((name) => name.trim() === trimmedQuery) ? searchUser : null;
      searchUser = user;
      if (!user && trimmedQuery) {
        const known = knownUsersNamed(trimmedQuery);
        try {
          const users = networkConnected ? await invoke<CatalogueUser[]>('resolve_catalogue_user', { query: trimmedQuery }) : [];
          if (generation !== browseGeneration) return;
          matchingUsers = [...new Map([...known, ...users].map((user) => [user.npub, user])).values()];
        } catch { if (generation === browseGeneration) matchingUsers = [...new Map(known.map((user) => [user.npub, user])).values()]; }
        if (generation !== browseGeneration) return;
        if (matchingUsers.length === 1) user = matchingUsers[0];
      }
      if (user) {
        searchUser = user;
        resultUser = user;
        matchingUsers = [];
        searchedQuery = user.displayName;
        format = 'Audio only';
        results = [];
        resultsAreNetwork = true;
        resultPage = 0;
        selectResult(null);
        try {
          if (user.npub === identityNpub) {
            results = mergeSearchResults([], sharedFiles);
          } else {
            const page = await invoke<CatalogueBrowsePage>('network_browse_user', { pubkey: user.pubkey, cursor: null });
            if (generation !== browseGeneration) return;
            loadedNetworkMatches = page.results;
            browseCursor = page.cursor;
            browseTotalAvailable = page.totalAvailable;
            results = mergeSearchResults(loadedNetworkMatches, []);
          }
          activityMessage = msg("{p0} tracks loaded from {p1}", { p0: results.length, p1: user.displayName });
          selectResult(results[0] ?? null, true);
          if (browseCursor) void loadNextBrowsePage();
        } catch (error) {
          if (generation === browseGeneration) activityMessage = msg("Could not browse {p0}: {p1}", { p0: user.displayName, p1: String(error) });
        }
        return;
      }
      searchedQuery = trimmedQuery || (format === 'Audiobooks' ? 'All audiobooks' : 'All audio');
      if (networkConnected) {
        if (format === 'Audiobooks') {
          try {
            loadedNetworkAudiobooks = await invoke<Audiobook[]>('network_search_audiobooks', { query: trimmedQuery });
            if (generation !== browseGeneration) return;
            results = mergeAudiobooks([], loadedNetworkAudiobooks, trimmedQuery);
            resultsAreNetwork = true;
            activityMessage = msg("{p0} audiobook collections found", { p0: results.length });
          } catch (error) {
            if (generation !== browseGeneration) return;
            loadedNetworkAudiobooks = [];
            results = mergeAudiobooks([], [], trimmedQuery);
            resultsAreNetwork = false;
            activityMessage = msg("Global audiobook search failed: {p0} · showing {p1} local collections", { p0: String(error), p1: results.length });
          }
        } else {
        const includeAudiobooks = /^audiobooks?$/i.test(trimmedQuery);
        const audiobookRequest = includeAudiobooks
          ? invoke<Audiobook[]>('network_search_audiobooks', { query: trimmedQuery })
              .then((books) => books, () => [] as Audiobook[])
          : Promise.resolve([] as Audiobook[]);
        const [networkOutcome, localOutcome] = await Promise.allSettled([
          trimmedQuery
            ? invoke<NetworkResult[]>('network_search', { query: trimmedQuery })
            : invoke<CatalogueBrowsePage>('network_browse', { cursor: null, limit: 500, cacheLimit: 10000 }),
          invoke<NativeFile[]>('search_catalog', { query: trimmedQuery })
        ]);
        if (generation !== browseGeneration) return;
        const networkMatches = networkOutcome.status === 'fulfilled'
          ? trimmedQuery
            ? networkOutcome.value as NetworkResult[]
            : (networkOutcome.value as CatalogueBrowsePage).results
          : [];
        const localMatches = localOutcome.status === 'fulfilled' ? localOutcome.value : [];
        loadedNetworkMatches = networkMatches;
        loadedNetworkAudiobooks = [];
        browseCursor = format !== 'Audiobooks' && networkOutcome.status === 'fulfilled' && !trimmedQuery
          ? (networkOutcome.value as CatalogueBrowsePage).cursor
          : null;
        browseTotalAvailable = format !== 'Audiobooks' && networkOutcome.status === 'fulfilled' && !trimmedQuery
          ? (networkOutcome.value as CatalogueBrowsePage).totalAvailable
          : 0;
        results = mergeAudiobooks(mergeSearchResults(networkMatches, localMatches), loadedNetworkAudiobooks, trimmedQuery);
        resultsAreNetwork = networkOutcome.status === 'fulfilled';
        if (networkOutcome.status === 'rejected') {
          activityMessage = localOutcome.status === 'fulfilled'
            ? msg("Global search failed: {p0} · showing {p1} local matches", { p0: String(networkOutcome.reason), p1: results.length })
            : msg("Search failed: {p0}", { p0: String(networkOutcome.reason) });
        } else {
          activityMessage = format === 'Audiobooks'
            ? msg("{p0} audiobook collections found", { p0: results.length })
            : !trimmedQuery
            ? msg("{p0} loaded of {p1} currently available file IDs, ranked by active seeders", { p0: results.length, p1: availableResultTotal(results, browseTotalAvailable) })
            : msg("{p0} available file IDs, ranked by active seeders", { p0: results.length });
        }
        // Audiobook manifests are additive. Let ordinary track results render
        // as soon as they are ready instead of making every search wait for a
        // second relay query and manifest validation pass.
        if (includeAudiobooks) void audiobookRequest.then((books) => {
          if (generation !== browseGeneration) return;
          loadedNetworkAudiobooks = books;
          results = mergeAudiobooks(
            mergeSearchResults(loadedNetworkMatches, localMatches),
            loadedNetworkAudiobooks,
            trimmedQuery
          );
          resultPage = 0;
          reconcileResultSelection(true);
          activityMessage = format === 'Audiobooks'
            ? msg("{p0} audiobook collections found", { p0: results.length })
            : !trimmedQuery
            ? msg("{p0} loaded of {p1} currently available file IDs, ranked by active seeders", { p0: results.length, p1: availableResultTotal(results, browseTotalAvailable) })
            : msg("{p0} available file IDs, ranked by active seeders", { p0: results.length });
        });
        }
      } else if (nativeReady) {
        try {
          const matches = await invoke<NativeFile[]>('search_catalog', { query: query.trim() });
          if (generation !== browseGeneration) return;
          results = mergeAudiobooks(mapFiles(matches.filter((item) => minimumSources <= 1 && item.size <= maximumBytes() && matchesType(item.mime, item.format))), [], query.trim());
          resultsAreNetwork = false;
          activityMessage = msg("{p0} local matches found", { p0: results.length });
        } catch (error) { if (generation === browseGeneration) activityMessage = msg("Search failed: {p0}", { p0: String(error) }); }
      }
      resultPage = 0;
      selectResult(results[0] ?? null, true);
      if (generation === browseGeneration && !query.trim() && browseCursor) {
        void loadNextBrowsePage();
      }
    } finally {
      if (generation === browseGeneration) searchAction = null;
    }
  }

  async function loadNextBrowsePage() {
    const cursor = browseCursor;
    const user = resultUser;
    if (!cursor || browseLoading || (!user && query.trim())) return;
    const generation = browseGeneration;
    browseLoading = true;
    activityMessage = msg("{p0} available file IDs loaded · fetching the next relay page…", { p0: results.length });
    try {
      const page = user
        ? await invoke<CatalogueBrowsePage>('network_browse_user', { pubkey: user.pubkey, cursor })
        : await invoke<CatalogueBrowsePage>('network_browse', { cursor, limit: 500, cacheLimit: 10000 });
      if (generation !== browseGeneration || (!user && query.trim())) return;
      loadedNetworkMatches = mergeNetworkPages(loadedNetworkMatches, page.results);
      browseCursor = page.cursor;
      browseTotalAvailable = page.totalAvailable;
      results = user ? mergeSearchResults(loadedNetworkMatches, []) : mergeAudiobooks(mergeSearchResults(loadedNetworkMatches, sharedFiles), loadedNetworkAudiobooks, '');
      resultsAreNetwork = true;
      reconcileResultSelection();
      activityMessage = user
        ? msg("{p0} loaded of {p1} tracks shared by {p2}", { p0: results.length, p1: availableResultTotal(results, browseTotalAvailable), p2: user.displayName })
        : msg("{p0} loaded of {p1} currently available file IDs, ranked by active seeders", { p0: results.length, p1: availableResultTotal(results, browseTotalAvailable) });
    } catch (error) {
      if (generation === browseGeneration) activityMessage = msg("Could not load the next catalogue page: {p0}", { p0: String(error) });
    } finally {
      if (generation === browseGeneration) browseLoading = false;
    }
  }

  async function surpriseMe() {
    if (searchAction) return;
    if (!networkConnected) {
      activityMessage = msg("Connect to Nostr before asking for a surprise");
      return;
    }
    const generation = ++browseGeneration;
    browseCursor = null;
    browseLoading = false;
    loadedNetworkMatches = [];
    loadedNetworkAudiobooks = [];
    browseTotalAvailable = 0;
    searchAction = 'surprise';
    searchUser = null;
    resultUser = null;
    matchingUsers = [];
    searchedQuery = 'Surprise me';
    query = '';
    format = 'Audio only';
    minimumSources = 1;
    maximumSize = '';
    activityMessage = msg("Finding 50 random downloadable tracks…");
    try {
      let cursor: CatalogueBrowseCursor | null = null;
      let downloadable: NetworkResult[] = [];
      do {
        const page: CatalogueBrowsePage = await invoke('network_browse', {
          cursor, limit: 100, cacheLimit: 50000, unownedOnly: true
        });
        if (generation !== browseGeneration) return;
        downloadable = eligibleNetworkMatches(mergeNetworkPages(downloadable, page.results))
          .filter((item) => !isLocalFile(item.fileId) && item.sources.length > 0);
        cursor = page.cursor;
      } while (downloadable.length < 50 && cursor);
      results = mapNetworkFiles(shuffled(downloadable).slice(0, 50));
      resultsAreNetwork = true;
      resultPage = 0;
      selectResult(results[0] ?? null, true);
      activityMessage = results.length
        ? msg("Random downloadable tracks found: {p0}", { p0: results.length })
        : msg("No downloadable tracks are currently available");
    } catch (error) {
      if (generation === browseGeneration) activityMessage = msg("Surprise search failed: {p0}", { p0: String(error) });
    } finally {
      if (generation === browseGeneration) searchAction = null;
    }
  }

  async function requestNetworkDownload(args: Record<string, unknown>) {
    if (clearingTransfers || cancellingFiles.has(String(args.fileId))) throw new Error('Download is being cancelled');
    const request = invoke('request_network_download', args);
    pendingDownloadRequests.set(request, String(args.fileId));
    try { return await request; }
    finally { pendingDownloadRequests.delete(request); }
  }

  async function startDownload(target: Result | null = selected): Promise<boolean> {
    if (!target || clearingTransfers || cancellingFiles.has(target.fileId)) return false;
    const generation = downloadGeneration;
    if (target.audiobook) {
      await startAudiobookDownload(target.audiobook);
      return true;
    }
    if (nativeReady && isLocalFile(target.fileId)) {
      await playAudio(target.fileId, target.name, playerMode, 'search');
      return false;
    }
    const activeTransfer = transfers.find((item) => item.fileId === target.fileId && isActiveTransfer(item));
    if (activeTransfer || startingDownloads.has(target.fileId)) {
      activityMessage = msg("{p0} is already downloading", { p0: target.name });
      return false;
    }
    if (nativeReady) {
      const sources = target.sourceDetails ?? [];
      if (!sources.length) { activityMessage = msg("No seeder is available for this file"); return false; }
      startingDownloads = new Set(startingDownloads).add(target.fileId);
      const attempt = { cancelled: false };
      downloadAttempts.set(target.fileId, attempt);
      transfers = showAvailableDownloadSlots([{
        id: ++nextOptimisticTransferId, fileId: target.fileId, name: target.name, size: target.size,
        speed: 'Queued', progress: 0, status: 'Queued', destination: ''
      }, ...transfers]);
      const candidateCount = Math.min(sources.length, 3);
      activityMessage = msg("Finding the fastest Tor connection. Seeders: {p0}…", { p0: candidateCount });
      try {
        await requestNetworkDownload({ fileId: target.fileId, sourcePubkeys: sources.map((source) => source.pubkey) });
        if (generation !== downloadGeneration || attempt.cancelled) return false;
        const updated = await invoke<NativeTransfer[]>('get_transfers');
        if (generation !== downloadGeneration || attempt.cancelled) return false;
        await applyTransferUpdate(updated);
        activityMessage = msg("Seeder race started · the fastest responsive source will stream the file");
        return true;
      } catch (error) {
        if (generation !== downloadGeneration || attempt.cancelled) return false;
        try {
          const updated = await invoke<NativeTransfer[]>('get_transfers');
          if (generation !== downloadGeneration || attempt.cancelled) return false;
          await applyTransferUpdate(updated);
        } catch {
          if (generation !== downloadGeneration || attempt.cancelled) return false;
          transfers = transfers.filter((item) => item.fileId !== target.fileId);
        }
        activityMessage = msg("Request failed: {p0}", { p0: String(error) });
      } finally {
        downloadAttempts.delete(target.fileId);
        const nextStarting = new Set(startingDownloads);
        nextStarting.delete(target.fileId);
        startingDownloads = nextStarting;
      }
    }
    return false;
  }

  async function playSelectedAudio() {
    if (!selected) return;
    if (selected.audiobook) {
      await playAudiobook(selected.audiobook);
      return;
    }
    if (!isLocalFile(selected.fileId)) return;
    await playAudio(selected.fileId, selected.name, playerMode, 'search');
  }

  function currentFolderAudiobook(books: Audiobook[], folderView: string) {
    if (folderView === '*') return null;
    return books.find((book) => book.localFolder === folderView) ?? null;
  }

  function openAudiobookEditor() {
    if (libraryFolderView === '*' || audiobookChapters.length < 1) return;
    const existing = folderAudiobook;
    const files = audiobookChapters;
    const folderTitle = folderName(libraryFolderView).split('/').at(-1) ?? 'Audiobook';
    audiobookTitle = existing?.title || files.find((file) => file.album)?.album || folderTitle.replace(/[_-]+/g, ' ');
    audiobookAuthor = existing?.author || files.find((file) => file.artist)?.artist || '';
    audiobookNarrator = existing?.narrator || '';
    audiobookEditorOpen = true;
  }

  async function saveAudiobookGroup() {
    if (audiobookSaving || libraryFolderView === '*') return;
    audiobookSaving = true;
    try {
      localAudiobooks = await invoke<Audiobook[]>('save_audiobook', {
        folder: libraryFolderView,
        title: audiobookTitle,
        author: audiobookAuthor,
        narrator: audiobookNarrator
      });
      audiobookEditorOpen = false;
      activityMessage = msg("{p0} grouped and queued for Nostr publication", { p0: audiobookTitle.trim() });
      syncResultLocality();
    } catch (error) {
      activityMessage = msg("Could not group audiobook: {p0}", { p0: String(error) });
    } finally {
      audiobookSaving = false;
    }
  }

  async function ungroupAudiobook() {
    const existing = folderAudiobook;
    if (!existing || audiobookSaving) return;
    audiobookSaving = true;
    try {
      localAudiobooks = await invoke<Audiobook[]>('remove_audiobook', { folder: existing.localFolder });
      audiobookEditorOpen = false;
      activityMessage = msg("{p0} is now published as individual tracks only", { p0: existing.title });
      syncResultLocality();
    } catch (error) {
      activityMessage = msg("Could not remove audiobook grouping: {p0}", { p0: String(error) });
    } finally {
      audiobookSaving = false;
    }
  }

  async function playAudiobook(book: Audiobook) {
    const firstReadyChapter = book.chapters.find((chapter) => isLocalFile(chapter.fileId));
    if (!firstReadyChapter) {
      activityMessage = msg("Download at least the first chapter before playing this audiobook");
      return;
    }
    await playAudiobookChapter(book, firstReadyChapter.fileId);
  }

  async function playAudiobookChapter(book: Audiobook, fileId: string) {
    const queue = book.chapters.flatMap((chapter) => {
      const file = sharedFiles.find((candidate) => candidate.fileId === chapter.fileId);
      return file ? [toPlayerTrack(file)] : [];
    });
    const index = queue.findIndex((chapter) => chapter.fileId === fileId);
    if (index < 0) {
      activityMessage = msg("That chapter has not finished downloading yet");
      return;
    }
    activePlayerAudiobook = book;
    playerOrigin = 'audiobook';
    playerMode = 'all';
    playerQueue = queue;
    await loadPlayerTrack(index);
  }

  function audiobookChapterStatus(book: Audiobook, chapter: AudiobookChapter) {
    if (isLocalFile(chapter.fileId)) return 'Ready';
    const download = audiobookDownloads.find((item) => item.audiobookId === book.audiobookId);
    return download?.activeFileId === chapter.fileId ? 'Downloading' : 'Waiting';
  }

  async function requestNextAudiobookChapter(audiobookId: string) {
    if (clearingTransfers) return;
    const queue = audiobookDownloads.find((item) => item.audiobookId === audiobookId);
    if (!queue || queue.activeFileId) return;
    while (queue.nextIndex < queue.chapters.length && isLocalFile(queue.chapters[queue.nextIndex].fileId)) queue.nextIndex += 1;
    if (queue.nextIndex >= queue.chapters.length) {
      const missing = queue.chapters.filter((chapter) => !isLocalFile(chapter.fileId)).length;
      if (missing) {
        audiobookDownloads = audiobookDownloads.filter((item) => item.audiobookId !== audiobookId);
        activityMessage = msg("{p0} · Missing chapters: {p1}. Select the book to retry.", { p0: queue.title, p1: missing });
        return;
      }
      if (queue.destinationFolder) {
        try {
          localAudiobooks = await invoke<Audiobook[]>('save_audiobook', {
            folder: `Audiobooks/${queue.destinationFolder}`,
            title: queue.title,
            author: queue.author,
            narrator: queue.narrator
          });
          syncResultLocality();
        } catch { /* downloaded chapters remain valid and can be grouped manually */ }
      }
      audiobookDownloads = audiobookDownloads.filter((item) => item.audiobookId !== audiobookId);
      activityMessage = msg("{p0} downloaded and ready to play", { p0: queue.title });
      return;
    }
    const chapter = queue.chapters[queue.nextIndex];
    queue.activeFileId = chapter.fileId;
    audiobookDownloads = [...audiobookDownloads];
    startingDownloads = new Set(startingDownloads).add(chapter.fileId);
    try {
      await requestNetworkDownload({
        fileId: chapter.fileId,
        sourcePubkeys: queue.sources.map((source) => source.pubkey),
        destinationFolder: queue.destinationFolder
      });
      if (!audiobookDownloads.includes(queue)) return;
      await applyTransferUpdate(await invoke<NativeTransfer[]>('get_transfers'));
      activityMessage = msg("Downloading {p0} · chapter {p1} of {p2}", { p0: queue.title, p1: queue.nextIndex + 1, p2: queue.chapters.length });
    } catch (error) {
      if (!audiobookDownloads.includes(queue)) return;
      queue.failed += 1;
      queue.nextIndex += 1;
      queue.activeFileId = '';
      audiobookDownloads = [...audiobookDownloads];
      activityMessage = msg("Chapter {p0} could not start: {p1} · continuing with the book", { p0: queue.nextIndex, p1: String(error) });
      void requestNextAudiobookChapter(audiobookId);
    } finally {
      const nextStarting = new Set(startingDownloads);
      nextStarting.delete(chapter.fileId);
      startingDownloads = nextStarting;
    }
  }

  async function advanceAudiobookDownloads() {
    for (const queue of [...audiobookDownloads]) {
      if (queue.activeFileId && isLocalFile(queue.activeFileId)) {
        queue.nextIndex += 1;
        queue.activeFileId = '';
      } else if (queue.activeFileId) {
        const transfer = transfers.find((item) => item.fileId === queue.activeFileId);
        if (transfer && isFinishedTransfer(transfer) && !isCompleteTransfer(transfer)) {
          queue.failed += 1;
          queue.nextIndex += 1;
          queue.activeFileId = '';
        }
      }
      audiobookDownloads = [...audiobookDownloads];
      if (!queue.activeFileId) await requestNextAudiobookChapter(queue.audiobookId);
    }
  }

  async function startAudiobookDownload(book: Audiobook) {
    if (clearingTransfers) return;
    if (book.chapters.every((chapter) => isLocalFile(chapter.fileId))) {
      await playAudiobook(book);
      return;
    }
    if (!book.sources.length) {
      activityMessage = msg("No complete audiobook seeder is currently available");
      return;
    }
    if (audiobookDownloads.some((item) => item.audiobookId === book.audiobookId)) {
      activityMessage = msg("{p0} is already in the download queue", { p0: book.title });
      return;
    }
    audiobookDownloads = [...audiobookDownloads, {
      audiobookId: book.audiobookId,
      title: book.title,
      author: book.author,
      narrator: book.narrator,
      destinationFolder: `${book.title.replace(/[\x00-\x1f/\\:*?"<>|]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 86) || 'Audiobook'} [${book.audiobookId.slice(0, 8)}]`,
      chapters: book.chapters,
      sources: book.sources,
      nextIndex: 0,
      activeFileId: '',
      failed: 0
    }];
    await requestNextAudiobookChapter(book.audiobookId);
  }

  function selectedAudiobookComplete(book: Audiobook | undefined, cached: Set<string>) {
    return book?.chapters.every((chapter) => cached.has(chapter.fileId)) ?? false;
  }

  function selectedAudiobookDownloading(book: Audiobook | undefined, downloads: AudiobookDownload[]) {
    const audiobookId = book?.audiobookId;
    return Boolean(audiobookId && downloads.some((item) => item.audiobookId === audiobookId));
  }

  async function playSelectedAudiobook() {
    const book = selected?.audiobook;
    if (book) await playAudiobook(book);
  }

  async function downloadSelectedAudiobook() {
    const book = selected?.audiobook;
    if (book) await startAudiobookDownload(book);
  }

  async function playSelectedSharedAudio() {
    if (!selectedShared) return;
    await playAudio(selectedShared.fileId, selectedShared.filename, playerMode, 'shared');
  }

  async function playSelectedFolder() {
    if (!selectedShared) return;
    await playAudio(selectedShared.fileId, selectedShared.filename, 'folder', 'shared');
  }

  async function playAllSongs() {
    const first = selectedShared ?? visibleSharedFiles()[0] ?? sharedFiles[0];
    if (!first) return;
    await playAudio(first.fileId, first.filename, 'all', 'shared');
  }

  async function activateSelected() {
    if (nativeReady && selected?.audiobook?.local) await playSelectedAudio();
    else if (nativeReady && selected && isLocalFile(selected.fileId)) await playSelectedAudio();
    else await startDownload();
  }

  function blockSelectedFile() {
    if (!nativeReady || !selected?.remote) return;
    blockConfirmation = { kind: 'file', fileId: selected.fileId, label: selected.name };
  }

  function blockSelectedUser() {
    const source = selected?.sourceDetails?.[selectedSource];
    if (!nativeReady || !source) return;
    blockConfirmation = { kind: 'user', pubkey: source.pubkey, label: source.displayName };
  }

  async function confirmBlock() {
    if (!blockConfirmation || blockInProgress) return;
    const target = blockConfirmation;
    blockInProgress = true;
    try {
      if (target.kind === 'file') {
        await invoke('block_file', { fileId: target.fileId });
        activityMessage = msg("File hash blocked locally");
      } else {
        await invoke('block_user', { pubkey: target.pubkey });
        activityMessage = msg("Nostr publisher blocked locally");
      }
      blockConfirmation = null;
      if (activeView === 'Trollbox') {
        trollboxMessages = trollboxMessages.filter((message) => message.pubkey !== ('pubkey' in target ? target.pubkey : ''));
        await refreshTrollbox();
      } else {
        await search();
      }
    } catch (error) {
      activityMessage = msg("Could not block {p0}: {p1}", { p0: target.kind, p1: String(error) });
    } finally {
      blockInProgress = false;
    }
  }

  async function removeTransfer(id: number) {
    if (clearingTransfers || removingTransfers.has(id)) return;
    const target = transfers.find((transfer) => transfer.id === id);
    const fileId = target && isActiveTransfer(target) ? target.fileId : undefined;
    audiobookDownloads = audiobookDownloads.filter((book) => book.activeFileId !== fileId);
    removingTransfers = new Set(removingTransfers).add(id);
    if (fileId) {
      cancellingFiles.add(fileId);
      const attempt = downloadAttempts.get(fileId);
      if (attempt) attempt.cancelled = true;
    }
    const pending = [...pendingDownloadRequests].filter(([, file]) => file === fileId).map(([request]) => request);
    activityMessage = msg("Stopping download and cleaning partial files…");
    try {
      if (nativeReady) {
        // Optimistic UI IDs are not database IDs. Find the actual row, and
        // drain any request still entering the backend before the final sweep.
        const removeRows = async () => {
          const rows = await invoke<NativeTransfer[]>('get_transfers');
          for (const row of rows) {
            if (row.id === id || (pending.length && fileId && row.id < 0 && row.fileId === fileId && isActiveTransfer(row))) {
              await invoke('remove_transfer', { id: row.id });
            }
          }
        };
        await removeRows();
        await Promise.allSettled(pending);
        if (pending.length) await removeRows();
      }
      transfers = transfers.filter((transfer) => transfer.id !== id && !(pending.length && fileId && transfer.fileId === fileId && isActiveTransfer(transfer)));
      activityMessage = msg("Transfer removed; completed audio kept");
    } catch (error) {
      activityMessage = msg("Could not remove transfer: {p0}", { p0: String(error) });
    } finally {
      if (fileId) cancellingFiles.delete(fileId);
      removingTransfers = new Set([...removingTransfers].filter((value) => value !== id));
    }
  }

  async function clearAllTransfers() {
    if (clearingTransfers || removingTransfers.size) return;
    clearingTransfers = true;
    downloadGeneration += 1;
    audiobookDownloads = [];
    const pending = [...pendingDownloadRequests.keys()];
    activityMessage = msg("Stopping downloads and cleaning partial files…");
    try {
      if (nativeReady) {
        await invoke('clear_all_transfers');
        // A request already sent by the UI may still be entering the backend.
        await Promise.allSettled(pending);
        if (pending.length) await invoke('clear_all_transfers');
        transfers = mapTransfers(await invoke<NativeTransfer[]>('get_transfers'));
      } else transfers = [];
      activityMessage = msg("All transfers cleared; partial downloads removed and completed audio kept");
    } catch (error) {
      activityMessage = msg("Could not clear all transfers: {p0}", { p0: String(error) });
    } finally {
      clearingTransfers = false;
    }
  }

  async function clearFinishedTransfers() {
    if (clearingTransfers || removingTransfers.size) return;
    const finished = transfers.filter(isFinishedTransfer);
    if (!finished.length) return;
    const removed = new Set<number>();
    for (const transfer of finished) {
      try {
        if (nativeReady) await invoke('remove_transfer', { id: transfer.id });
        removed.add(transfer.id);
      } catch (error) {
        activityMessage = msg("Could not clear every finished transfer: {p0}", { p0: String(error) });
        break;
      }
    }
    transfers = transfers.filter((transfer) => !removed.has(transfer.id));
    if (removed.size === finished.length) activityMessage = msg("Finished transfers cleared: {p0}", { p0: removed.size });
    if (nativeReady) await refreshLocalLibrary();
  }

  async function togglePause() {
    paused = !paused;
    if (nativeReady) {
      try { await invoke('set_downloads_paused', { paused }); activityMessage = paused ? msg("All active downloads paused") : msg("Downloads resumed"); }
      catch (error) { activityMessage = msg("Could not change download state: {p0}", { p0: String(error) }); }
    }
  }

  async function chooseNapstrFolder() {
    if (!nativeReady) { activityMessage = msg("Folder selection is available in the packaged desktop app"); return; }
    try {
      const selectedPath = await open({ directory: true, multiple: false, title: $t("Choose the folder Deadwax uses for downloads and sharing"), defaultPath: napstrFolder || undefined });
      if (!selectedPath || Array.isArray(selectedPath)) return;
      activityMessage = msg("Indexing files and calculating SHA-256 hashes…");
      const report = await invoke<{ fileCount: number; totalBytes: number; errors: string[]; errorCount: number; changedFiles: number }>('set_napstr_folder', { path: selectedPath });
      activityMessage = msg("Indexed {p0} files, {p1}{p2}", { p0: report.fileCount, p1: readableSize(report.totalBytes), p2: report.errorCount ? ` · ${report.errorCount} skipped` : '' });
    } catch (error) { activityMessage = msg("Folder selection failed: {p0}", { p0: String(error) }); }
  }

  async function openNapstrFolder() {
    if (!nativeReady) return;
    try { await invoke('open_napstr_folder'); }
    catch (error) { activityMessage = msg("Could not open Deadwax folder: {p0}", { p0: String(error) }); }
  }

  async function rescanSharedFolder() {
    if (!nativeReady || rescanPending) return;
    rescanPending = true;
    activityMessage = msg("Rescanning Deadwax folder…");
    try {
      const report = await invoke<{ fileCount: number; totalBytes: number; changedFiles: number }>('rescan_napstr_folder');
      activityMessage = msg("Indexed {p0} files, {p1}", { p0: report.fileCount, p1: readableSize(report.totalBytes) });
    } catch (error) {
      activityMessage = msg("Rescan failed: {p0}", { p0: String(error) });
    } finally {
      rescanPending = false;
    }
  }

  async function cancelLibraryScan() {
    if (!nativeReady || !indexing) return;
    try {
      await invoke('cancel_library_scan');
      activityMessage = msg("Cancelling the library scan…");
    } catch (error) {
      activityMessage = msg("Could not cancel indexing: {p0}", { p0: String(error) });
    }
  }

  async function persistSettings() {
    if (!nativeReady) return;
    try {
      applySnapshot(await invoke<Snapshot>('save_settings', { settings: { napstrFolder, nostrRelays, displayName, profileAbout, profilePicture } }));
      if (networkConnected) await invoke('publish_profile');
      activityMessage = networkConnected ? msg("Settings saved and profile published") : msg("Settings saved");
    } catch (error) { activityMessage = msg("Could not save settings: {p0}", { p0: String(error) }); }
  }

  const windowCommand = async (command: 'minimise_window' | 'toggle_maximise' | 'close_window') => {
    if (nativeReady) await invoke(command);
  };

  function beginWindowResize(event: PointerEvent, direction: WindowResizeDirection) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    getCurrentWindow().startResizeDragging(direction).catch(() => {});
  }

  onMount(() => initializeLocale(() => osLocale()));

  onMount(() => {
    try { railExpanded = window.localStorage.getItem('deadwax-rail') === '1'; } catch { /* a blocked store leaves the rail closed */ }
    try {
      const stored = window.localStorage.getItem('deadwax-playlist-view');
      if (stored === 'list' || stored === 'grid') playlistView = stored;
    } catch { /* the default view is a tile grid */ }
  });

  onMount(() => {
    try {
      const stored = window.localStorage.getItem('deadwax-theme');
      const light = stored ? stored === 'light' : window.matchMedia('(prefers-color-scheme: light)').matches;
      theme = light ? 'light' : 'dark';
      document.documentElement.dataset.theme = theme;
    } catch { /* app.html has already picked one */ }
  });

  onMount(() => {
    desktopRuntime = '__TAURI_INTERNALS__' in window;
    if (!desktopRuntime) return;
    const savedPlayerMode = readStoredPreference('napstr-player-mode');
    if (savedPlayerMode === 'single' || savedPlayerMode === 'folder' || savedPlayerMode === 'all') playerMode = savedPlayerMode;
    const savedPlayerVolume = Number(readStoredPreference('napstr-player-volume'));
    if (Number.isFinite(savedPlayerVolume) && savedPlayerVolume >= 0 && savedPlayerVolume <= 1) playerVolume = savedPlayerVolume;
    if (window.localStorage.getItem(RESULTS_VIEW_KEY) === 'thumb') resultsView = 'thumb';
    refreshSnapshot().then(connectNetwork);
    // The two cover switches live in the database, so the window can show their
    // real state straight away instead of only after a visit to the Covers tab.
    void refreshCoverStatus();
    void getVersion()
      .then((version) => {
        appVersion = version;
        return checkForNewRelease();
      })
      .catch(() => {
        appVersion = 'unknown';
      });
    let destroyed = false;
    const eventUnlisteners: UnlistenFn[] = [];
    void listen<string>('napstr-public-chat', ({ payload: topic }) => {
      if (topic === 'napstr-trollbox') void refreshTrollbox();
      const fileId = selected?.fileId?.toLowerCase();
      if (fileId && topic === `napstr-${fileId}`) void refreshTrackDiscussion(fileId);
    }).then((unlisten) => {
      if (destroyed) unlisten();
      else eventUnlisteners.push(unlisten);
    });
    void listen('napstr-library-changed', () => {
      void refreshLocalLibrary();
    }).then((unlisten) => {
      if (destroyed) unlisten();
      else eventUnlisteners.push(unlisten);
    });
    void listen<RemotePlaybackCommand>('napstr-remote-playback', ({ payload }) => {
      void handleRemoteCommand(payload);
    }).then((unlisten) => {
      if (destroyed) unlisten();
      else eventUnlisteners.push(unlisten);
    });
    void listen('napstr-transfers-changed', () => {
      void invoke<NativeTransfer[]>('get_transfers')
        .then(async (items) => {
          if (clearingTransfers || removingTransfers.size) return;
          await applyTransferUpdate(items);
          if (audiobookDownloads.length) await advanceAudiobookDownloads();
        })
        .catch(() => {});
    }).then((unlisten) => {
      if (destroyed) unlisten();
      else eventUnlisteners.push(unlisten);
    });
    void listen<CoverStatus>('napstr-cover-status', ({ payload }) => {
      const grew =
        payload.published > (coverStatus?.published ?? 0) ||
        payload.resolved > (coverStatus?.resolved ?? 0);
      const finished = Boolean(coverStatus?.running) && !payload.running;
      coverStatus = payload;
      // New art exists, so the tiles are stale. On a long pass this also lets
      // covers appear as they are found instead of all at the end.
      if (grew || finished) refreshCoverArtwork();
      if (finished && activeView === 'Covers') void refreshCovers();
    }).then((unlisten) => {
      if (destroyed) unlisten();
      else eventUnlisteners.push(unlisten);
    });
    void listen<IndexBatch>('napstr-index-batch', ({ payload }) => {
      mergeIndexBatch(payload);
    }).then((unlisten) => {
      if (destroyed) unlisten();
      else eventUnlisteners.push(unlisten);
    });
    void listen<IndexProgress>('napstr-index-progress', ({ payload }) => {
      indexing = payload.scanning;
      if (payload.message) activityMessage = payload.message;
      if (!payload.scanning) rescanPending = false;
    }).then((unlisten) => {
      if (destroyed) unlisten();
      else eventUnlisteners.push(unlisten);
    });
    const updateClock = () => {
      clockNow = Date.now();
    };
    updateClock();
    const clockTimer = window.setInterval(updateClock, 30000);
    let lastWakeTick = Date.now();
    let lastWakeRecovery = 0;
    const detectWake = () => {
      const now = Date.now();
      const elapsed = now - lastWakeTick;
      lastWakeTick = now;
      if (elapsed > 20000 && now - lastWakeRecovery > 15000) {
        lastWakeRecovery = now;
        window.setTimeout(() => void recoverAfterSleep(), 1200);
      }
    };
    const foregrounded = () => {
      if (!document.hidden) detectWake();
    };
    window.addEventListener('focus', foregrounded);
    document.addEventListener('visibilitychange', foregrounded);
    const wakeTimer = window.setInterval(detectWake, 5000);
    let networkPollPending = false;
    const networkTimer = window.setInterval(async () => {
      if (!nativeReady || networkPollPending) return;
      networkPollPending = true;
      try {
        const status = await invoke<NetworkStatus>('network_status');
        const previousTorError = torError;
        const wasConnected = networkConnected;
        applyNetworkStatus(status);
        if (status.torError && status.torError !== previousTorError) {
          activityMessage = msg("Tor failed: {p0} · click the connection panel to retry", { p0: status.torError });
        } else if (!wasConnected && status.connected) {
          activityMessage = msg("Nostr reconnected · refreshing the catalogue");
          void search();
          if (activeView === 'Trollbox') void refreshTrollbox();
        } else if (!status.connected && !networkConnectPending) {
          void connectNetwork();
        }
      } catch { /* the next health poll retries */ }
      finally { networkPollPending = false; }
    }, 5000);
    let transferPollPending = false;
    const transferTimer = window.setInterval(async () => {
      const transferWorkPending =
        downloadLibraryRefreshNeeded ||
        startingDownloads.size > 0 ||
        audiobookDownloads.length > 0 ||
        transfers.some(isActiveTransfer);
      if (!nativeReady || transferPollPending || !transferWorkPending || clearingTransfers || removingTransfers.size) return;
      transferPollPending = true;
      try {
        const items = await invoke<NativeTransfer[]>('get_transfers');
        if (clearingTransfers || removingTransfers.size) return;
        await applyTransferUpdate(items);
        if (audiobookDownloads.length) await advanceAudiobookDownloads();
      } catch { /* the next transfer poll retries */ }
      finally { transferPollPending = false; }
    }, 1000);
    const playerTimer = window.setInterval(() => {
      if (!nativeReady || !currentTrack || playerLoading) return;
      invoke<PlaybackStatus>('audio_status').then((status) => {
        const naturallyEnded = status.fileId === currentTrack?.fileId && status.ended && !playerEnded;
        applyPlaybackStatus(status);
        if (naturallyEnded) void playerTrackEnded();
      }).catch(() => {});
    }, 250);
    const mobileTimer = window.setInterval(() => {
      if (mobileStreamPairing && mobileStreamPairing.expiresAt <= Math.floor(Date.now() / 1000)) mobileStreamPairing = null;
      if (activeView === 'Clients') void refreshMobileStatus();
    }, 3000);
    return () => {
      destroyed = true;
      eventUnlisteners.forEach((unlisten) => unlisten());
      clearInterval(clockTimer);
      clearInterval(wakeTimer);
      clearInterval(networkTimer);
      clearInterval(transferTimer);
      clearInterval(playerTimer);
      clearInterval(mobileTimer);
      window.removeEventListener('focus', foregrounded);
      document.removeEventListener('visibilitychange', foregrounded);
      if (nativeReady && currentTrack) invoke<PlaybackStatus>('stop_audio').catch(() => {});
    };
  });
</script>

<svelte:head><title>{$t("Deadwax - own your music again")}</title></svelte:head>

{#if desktopRuntime}
<main class="desktop">
  <section class="app-window" class:rail-expanded={railExpanded} aria-label={$t("Deadwax application window")}>
    <button class="window-resize-handle resize-n" aria-label={$t("Resize window from top")} onpointerdown={(event) => beginWindowResize(event, 'North')}></button>
    <button class="window-resize-handle resize-e" aria-label={$t("Resize window from right")} onpointerdown={(event) => beginWindowResize(event, 'East')}></button>
    <button class="window-resize-handle resize-s" aria-label={$t("Resize window from bottom")} onpointerdown={(event) => beginWindowResize(event, 'South')}></button>
    <button class="window-resize-handle resize-w" aria-label={$t("Resize window from left")} onpointerdown={(event) => beginWindowResize(event, 'West')}></button>
    <button class="window-resize-handle resize-ne" aria-label={$t("Resize window from top right")} onpointerdown={(event) => beginWindowResize(event, 'NorthEast')}></button>
    <button class="window-resize-handle resize-se" aria-label={$t("Resize window from bottom right")} onpointerdown={(event) => beginWindowResize(event, 'SouthEast')}></button>
    <button class="window-resize-handle resize-sw" aria-label={$t("Resize window from bottom left")} onpointerdown={(event) => beginWindowResize(event, 'SouthWest')}></button>
    <button class="window-resize-handle resize-nw" aria-label={$t("Resize window from top left")} onpointerdown={(event) => beginWindowResize(event, 'NorthWest')}></button>

    <nav class="rail" aria-label={$t("Views")}>
      <div class="rail-mark" title="Deadwax"><img src="/deadwax-logo-mark.png" alt="" /></div>
      {#each views as view}
        <button class:active={activeView === view.label} class="tool-button rail-button" title={$t(view.label)} onclick={() => activateView(view.label)}>
          <svg class="rail-icon" viewBox="0 0 24 24" aria-hidden="true"><path d={viewIcons[view.label]} /></svg>
          <span class="rail-label">{$t(view.label)}</span>
        </button>
      {/each}
      <div class="rail-spacer"></div>
      <div class="rail-divider"></div>
      <button class="rail-button rail-about" title={$t("About")} onclick={() => (aboutOpen = true)}>
        <svg class="rail-icon" viewBox="0 0 24 24" aria-hidden="true"><path d={aboutIcon} /></svg>
        <span class="rail-label">{$t("About")}</span>
      </button>
      <button class="rail-button rail-toggle" aria-expanded={railExpanded} title={railExpanded ? $t("Collapse the rail") : $t("Expand the rail")} onclick={toggleRail}>
        <svg class="rail-icon" viewBox="0 0 24 24" aria-hidden="true"><path d={railExpanded ? railChevron.open : railChevron.closed} /></svg>
        <span class="rail-label">{$t(railExpanded ? "Collapse" : "Expand")}</span>
      </button>
    </nav>

    <div class="console-main">
      <header class="topbar" data-tauri-drag-region>
        <div class="wordmark">
          <b>deadwax</b><span class="caret" aria-hidden="true"></span><span class="wordmark-section">{$t(activeView)}</span>
        </div>
        <div class="topbar-grow"></div>
        {#if newRelease}
          <button class="ghost release-button" onclick={openNewRelease} title={$t("Open Deadwax {p0} on GitHub", { p0: newRelease.version })}>
            <span class="release-arrow">⇧</span><span>{$t("New release")} {newRelease.version}</span>
          </button>
        {/if}
        <button class="ghost connection-box" onclick={connectNetwork} title={torError || networkError || $t("Reconnect Nostr and Tor")}>
          <span class="connection-status"><i class:amber={!networkConnected} class="led"></i><span>{networkConnected ? $t("Nostr connected") : $t("Connect Nostr")}</span></span>
          <span class="connection-status"><i class:amber={!torRunning} class:error={Boolean(torError)} class="led"></i><span>{$t(torStatusLabel())}</span></span>
        </button>
        <button class="ghost user-chip" disabled={!identityNpub} onclick={() => browseUser(ownCatalogueUser())}>{displayName}</button>
        <button class="ghost theme-toggle" onclick={toggleTheme} title={$t("Switch between light and dark")} aria-label={$t("Switch between light and dark")} aria-pressed={theme === 'light'}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {#if theme === 'light'}
              <circle cx="12" cy="12" r="4.1" />
              <path d="M12 3.2v2M12 18.8v2M3.2 12h2M18.8 12h2M5.9 5.9l1.4 1.4M16.7 16.7l1.4 1.4M18.1 5.9l-1.4 1.4M7.3 16.7l-1.4 1.4" />
            {:else}
              <path d="M20 14.4A8.4 8.4 0 0 1 9.6 4a8.4 8.4 0 1 0 10.4 10.4z" />
            {/if}
          </svg>
        </button>
        <div class="window-controls" aria-hidden="true">
          <button tabindex="-1" onclick={() => windowCommand('minimise_window')}>_</button><button tabindex="-1" onclick={() => windowCommand('toggle_maximise')}>□</button><button tabindex="-1" onclick={() => windowCommand('close_window')}>×</button>
        </div>
      </header>

    <div class="workspace">
      {#if activeView === 'Search'}
        <section class="panel search-panel">
          <div class="panel-title"><span></span><b>{$t("Search the network")}</b><span></span></div>
          <form class="search-form" onsubmit={(e) => { e.preventDefault(); search(); }}>
            <label for="search-query">{$t("Search:")}</label>
            <input id="search-query" bind:value={query} list="search-suggestions" autocomplete="off" placeholder={$t("punk, rock, jazz, audiobook")} />
            <datalist id="search-suggestions">
              {#each searchSuggestions as word}<option value={word}></option>{/each}
            </datalist>
            <label for="format">{$t("File type:")}</label>
            <select id="format" bind:value={format} disabled={searchAction !== null} onchange={() => void search()}><option value="Audio only">{$t("Audio only")}</option><option value="Audiobooks">{$t("Audiobooks")}</option></select>
            <button class="classic-button primary search-button" type="submit" disabled={searchAction !== null} aria-busy={searchAction === 'search'}>
              {#if searchAction === 'search'}<span class="search-spinner" aria-hidden="true"></span>{/if}
              {searchAction === 'search' ? $t("Searching") : $t("Search")}
            </button>
            <button class="classic-button surprise-button" type="button" onclick={surpriseMe} disabled={searchAction !== null || !networkConnected} aria-busy={searchAction === 'surprise'}>
              {#if searchAction === 'surprise'}<span class="search-spinner" aria-hidden="true"></span>{/if}
              {searchAction === 'surprise' ? $t("Choosing…") : $t("Surprise me")}
            </button>
          </form>
          {#if resultUser}
            <div class="user-search-status"><span>{$t("Shared by")} <b>{resultUser.displayName}</b> <code title={resultUser.npub}>{resultUser.npub.slice(0, 18)}…</code></span><button class="classic-button" disabled={searchAction !== null} onclick={() => { query = ''; searchUser = null; void search(); }}>{$t("Clear user filter")}</button></div>
          {:else if matchingUsers.length > 1}
            <div class="user-search-status"><span>{$t("Several users have this name. Choose whose songs to browse:")}</span>{#each matchingUsers as user}<button class="classic-button" title={user.npub} onclick={() => browseUser(user)}>{user.displayName} · {user.npub.slice(0, 18)}…</button>{/each}</div>
          {/if}
          <button class="advanced-toggle" onclick={() => (advanced = !advanced)}><span>{advanced ? '▼' : '▶'}</span> {advanced ? $t("Hide advanced search options") : $t("Show advanced search options")}</button>
          {#if advanced}
            <div class="advanced-row"><label>{$t("Minimum seeders:")} <input type="number" bind:value={minimumSources} min="1" /></label><label>{$t("Maximum size:")} <input bind:value={maximumSize} placeholder={$t("e.g. 2 GB")} /></label><label>{$t("File type:")} <select bind:value={advancedFormat} onchange={() => (resultPage = 0)}>{#each ADVANCED_FORMATS as option}<option value={option}>{option}</option>{/each}</select></label><label title={$t("Only known for files this computer has itself")}>{$t("Minimum bitrate (kbps):")} <input type="number" value={minimumBitrate || ''} min="0" step="32" placeholder={$t("any")} oninput={(event) => { minimumBitrate = Number(event.currentTarget.value) || 0; resultPage = 0; }} /></label><label><input type="checkbox" checked disabled /> {$t("Online seeders only")}</label></div>
          {/if}
        </section>

        <div class="split-content">
          <section class="results-pane" aria-label={$t("Search results")}>
            <div class="section-caption">
              <span>{$t("Results for “{p0}”", { p0: ["All audio", "All audiobooks", "local catalogue", "Surprise me"].includes(searchedQuery) ? $t(searchedQuery) : searchedQuery })}</span>
              <div class="results-caption-tools">
                <small>{format === 'Audiobooks' ? $t("Audiobooks found: {p0}", { p0: shownResults.length }) : browseTotalAvailable ? $t("{p0} loaded of {p1} available", { p0: shownResults.length, p1: resultAvailableTotal }) : $t("{p0} file IDs found", { p0: shownResults.length })}</small>
                <button type="button" class="view-toggle" class:active={resultsView === 'list'} title={$t("Show these results as a list")} aria-pressed={resultsView === 'list'} onclick={() => setResultsView('list')}>▤</button>
                <button type="button" class="view-toggle" class:active={resultsView === 'thumb'} title={$t("Show these results as thumbnails, with album art")} aria-pressed={resultsView === 'thumb'} onclick={() => setResultsView('thumb')}>▦</button>
              </div>
            </div>
            {#if resultsView === 'thumb'}
              <div class="result-grid" aria-label={$t("Search results as thumbnails")}>
                {#each resultPageItems as item}
                  <button
                    type="button"
                    class="result-card"
                    class:selected={selectedResultIds.has(item.fileId)}
                    aria-pressed={selectedResultIds.has(item.fileId)}
                    onclick={(event) => selectResultRange(item, event)}
                    ondblclick={(event) => { if (!event.shiftKey) void activateSelected(); }}
                  >
                    <span class="result-art">
                      {#if item.audiobook}
                        <span class="cover-art medium empty" aria-hidden="true">▥</span>
                      {:else}
                        <CoverArt artist={item.artist ?? ''} album={item.album ?? ''} preferThumb size="medium" revision={coverRevision} />
                      {/if}
                      <span class="result-overlay">
                        <b title={item.name}>{item.name}</b>
                        <small title={[item.artist, item.album].filter(Boolean).join(' · ') || undefined}>{item.artist || $t('Unknown artist')}{item.album ? ` · ${item.album}` : ''}</small>
                        <span class="result-card-meta"><i class="source-dot"></i>{item.sources} {item.sources === 1 ? $t('seeder') : $t('seeders')} · {item.size}{#if discussionActivity[item.fileId]}<span class="result-chat" title={discussionMarkLabel(discussionActivity[item.fileId])}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.2 5.4h15.6v9.8H9.6L5.2 19v-3.8H4.2z" /></svg>{discussionActivity[item.fileId].messages}</span>{/if}</span>
                      </span>
                      {#if isLocalFile(item.fileId)}<span class="host-mark on-art" title={$t("Already on this computer")}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4.6" width="18" height="11.8" rx="2" /><path d="M9 20h6M12 16.4V20" /></svg></span>{/if}
                    </span>
                  </button>
                {/each}
                {#if shownResults.length === 0}<p class="empty-state">{$t("Nothing to show yet.")}</p>{/if}
              </div>
            {:else}
            <div class="table-wrap">
              <table class="file-table search-results-table">
                <thead><tr>
                  <th class="name-col"><button type="button" class="sort-head" onclick={() => sortResultsBy('name')}>{$t("Name")}{resultSort === 'name' ? (resultSortAsc ? ' ▲' : ' ▼') : ''}</button></th>
                  <th><button type="button" class="sort-head" onclick={() => sortResultsBy('artist')}>{$t("Artist")}{resultSort === 'artist' ? (resultSortAsc ? ' ▲' : ' ▼') : ''}</button></th>
                  <th><button type="button" class="sort-head" onclick={() => sortResultsBy('album')}>{$t("Album")}{resultSort === 'album' ? (resultSortAsc ? ' ▲' : ' ▼') : ''}</button></th>
                  <th><button type="button" class="sort-head" onclick={() => sortResultsBy('format')}>{$t("Type")}{resultSort === 'format' ? (resultSortAsc ? ' ▲' : ' ▼') : ''}</button></th>
                  <th class="number"><button type="button" class="sort-head" onclick={() => sortResultsBy('size')}>{$t("Size")}{resultSort === 'size' ? (resultSortAsc ? ' ▲' : ' ▼') : ''}</button></th>
                  <th class="number"><button type="button" class="sort-head" onclick={() => sortResultsBy('sources')}>{$t("Seeders")}{resultSort === 'sources' ? (resultSortAsc ? ' ▲' : ' ▼') : ''}</button></th>
                  <th>{$t("Line speed")}</th>
                </tr></thead>
                <tbody>
                  {#each resultPageItems as item}
                    <tr class:selected={selectedResultIds.has(item.fileId)} aria-selected={selectedResultIds.has(item.fileId)} tabindex="0"
                      onclick={(event) => selectResultRange(item, event)}
                      onkeydown={(event) => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); selectResultRange(item, event); } }}
                      ondblclick={(event) => { if (!event.shiftKey) void activateSelected(); }}>
                      <td>{#if isLocalFile(item.fileId)}<span class="host-mark" title={$t("Already on this computer")}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4.6" width="18" height="11.8" rx="2" /><path d="M9 20h6M12 16.4V20" /></svg></span>{:else}<span class="host-mark absent" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="4.6" width="18" height="11.8" rx="2" /><path d="M9 20h6M12 16.4V20" /></svg></span>{/if}{item.name}{#if discussionActivity[item.fileId]}<span class="discussion-mark" title={discussionMarkLabel(discussionActivity[item.fileId])}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.2 5.4h15.6v9.8H9.6L5.2 19v-3.8H4.2z" /></svg>{discussionActivity[item.fileId].messages}</span>{/if}</td>
                      <td>{item.artist || '—'}</td><td>{item.album || '—'}</td><td>{item.format}</td><td class="number">{item.size}</td><td class="number"><span class="source-dot"></span>{item.sources}</td><td>{$t(item.speed)}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
            {/if}
            <div class="results-pager">
              <button onclick={() => void changeResultPage(resultPage - 1)} disabled={resultPage === 0}>{$t("◀ Previous")}</button>
              <span>{$t("Showing {range} of {count} loaded", { range: resultRangeLabel, count: results.length })}{browseTotalAvailable ? $t(" · {p0} available", { p0: resultAvailableTotal }) : ''} · {$t("Page {page} of {pages}", { page: resultPage + 1, pages: resultPageTotal })}{browseCursor ? '+' : ''}</span>
              <button onclick={() => void changeResultPage(resultPage + 1)} disabled={browseLoading || (resultPage + 1 >= resultPageTotal && !browseCursor)}>{browseLoading ? $t("Loading…") : $t("Next ▶")}</button>
            </div>
          </section>

          <aside class="details-pane">
            <div class="section-caption"><span>{$t("File details")}</span></div>
            {#if selected}
              {#if selectedResultIds.size > 1}
                <div class="selected-file">
                  <div class="large-file-icon">♫</div>
                  <div><strong>{$t("Selected tracks: {p0}", { p0: selectedResultIds.size })}</strong><span>{$t("Click a track, then Shift-click another to select a range.")}</span></div>
                </div>
                <div class="detail-actions"><button class="classic-button primary" onclick={downloadSelectedResults} disabled={!nativeReady || downloadingSelection || !selectedResults().some(canDownloadResult)} aria-busy={downloadingSelection}>{downloadingSelection ? $t("… Requesting") : $t("⇩ Download All")}</button></div>
                <p class="privacy-note"><span>♜</span> {$t("Downloads use Tor. Tracks already on this computer, queued, or without seeders are skipped.")}</p>
              {:else if selected.audiobook}
                <div class="selected-file audiobook-selected">
                  <div class="large-file-icon">▥</div>
                  <div><strong>{selected.audiobook.title}</strong><span>{$t("Audiobook ·")} {selected.audiobook.chapters.length} {$t("chapters ·")} {selected.size}</span><small>{$t("Edition ID:")} {selected.audiobook.audiobookId}</small></div>
                </div>
                <div class="file-metadata"><p><b>{selected.audiobook.author || $t("Unknown author")}</b>{selected.audiobook.narrator ? $t(" · Narrated by {p0}", { p0: selected.audiobook.narrator }) : ''}</p><small>{$t("Chapters are ordered and each file is independently SHA-256 verified.")}</small></div>
                <div class="audiobook-chapters" aria-label={$t("Audiobook chapters")}>
                  {#each selected.audiobook.chapters as chapter}
                    <button
                      type="button"
                      class:chapter-local={isLocalFile(chapter.fileId)}
                      class:chapter-playing={currentTrack?.fileId === chapter.fileId}
                      disabled={!isLocalFile(chapter.fileId)}
                      title={isLocalFile(chapter.fileId) ? $t("Play {p0}", { p0: chapter.title }) : $t("{p0} has not downloaded yet", { p0: chapter.title })}
                      onclick={() => playAudiobookChapter(selected!.audiobook!, chapter.fileId)}
                    ><span>{String(chapter.position).padStart(2, '0')}</span><b>{chapter.title}</b><small>{readableSize(chapter.size)}</small><i>{$t(audiobookChapterStatus(selected.audiobook!, chapter))}</i></button>
                  {/each}
                </div>
                <div class="detail-actions">{#if selectedAudiobookIsComplete}<button class="classic-button primary" onclick={playSelectedAudiobook}>{$t("▶ Play book")}</button><button class="classic-button" onclick={openNapstrFolder}>{$t("Open folder")}</button>{:else}<button class="classic-button primary" disabled={selectedAudiobookIsDownloading} onclick={downloadSelectedAudiobook}>⇩ {selectedAudiobookIsDownloading ? $t("Downloading…") : $t("Download book")}</button>{/if}</div>
                {#if !selected.audiobook.local}<p class="privacy-note"><span>♜</span> {$t("Chapters download first-to-last through private Tor onion services. Play each chapter as soon as it shows Ready.")}</p>{:else}<p class="privacy-note"><span>♬</span> {$t("This complete audiobook is ready to play.")}</p>{/if}
              {:else}
              <div class="detail-hero">
                <CoverArt artist={selected.artist ?? ''} album={selected.album ?? ''} size="large" revision={coverRevision} />
                <span class="detail-hero-scrim" aria-hidden="true"></span>
                <span class="detail-hero-text">
                  <b title={selected.name}>{selected.name}</b>
                  <small>{selected.artist || $t('Unknown artist')}{selected.album ? ` · ${selected.album}` : ''}</small>
                  <span class="detail-hero-meta">{selected.format} · {selected.size} · {selected.length}</span>
                </span>
                {#if selected.artist && selected.album}
                  <span class="detail-hero-tools">
                    <button class="icon-button" title={$t("Fix album art…")} aria-label={$t("Fix album art…")} onclick={() => void openCoverPicker(selected?.artist ?? '', selected?.album ?? '')}>
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 17.2 15.8 5.9a2 2 0 0 1 2.8 0l.5.5a2 2 0 0 1 0 2.8L7.8 20H4.5z" /><path d="M14.6 7.1 17 9.5" /></svg>
                    </button>
                    <button class="icon-button" title={$t("Report cover…")} aria-label={$t("Report cover…")} onclick={() => openCoverReport(selected?.artist ?? '', selected?.album ?? '')}>
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.6v16.8" /><path d="M6 4.6h10.6l-2.1 3.6 2.1 3.6H6z" /></svg>
                    </button>
                  </span>
                {/if}
              </div>
              {#if selected.tags}<div class="file-metadata"><small>{$t("Tags:")} {selected.tags}</small></div>{/if}
              <fieldset><legend>{$t("Seeders")}</legend>
                <div class="sources-list">
                  {#if !isLocalFile(selected.fileId)}
                    {#each (selected.sourceDetails ?? []).slice(0, VISIBLE_SEEDER_LIMIT) as source, index}
                      <div class:selected-source={selectedSource === index} class="source-row"><button class="user-icon source-select" title={$t("Select {p0} for profile and moderation actions", { p0: source.displayName })} onclick={() => (selectedSource = index)}>☺</button><button class="user-name" title={$t("Browse songs shared by {p0}", { p0: source.displayName })} onclick={() => browseUser(source)}>{source.displayName}</button><small>{source.npub.slice(0, 12)}…</small><span class="online"><i></i> {$t("Seeding")}</span></div>
                    {/each}
                  {:else}
                    <div><span class="user-icon">☺</span><b>{$t("This computer")}</b><small>{$t("Local")}</small><span class="online"><i></i> {$t("Ready")}</span></div>
                  {/if}
                </div>
              </fieldset>
              <div class="detail-actions">{#if !isLocalFile(selected.fileId)}<button class="classic-button primary" disabled={startingDownloads.has(selected.fileId)} title={$t("Transfer will use the seeder’s private, app-session Tor onion service.")} onclick={() => startDownload()}>{startingDownloads.has(selected.fileId) ? $t("… Requesting") : $t("⇩ Download")}</button><button class="classic-button" onclick={() => (sourceProfile = selected?.sourceDetails?.[selectedSource] ?? null)}>{$t("View profile")}</button>{:else}<button class="classic-button primary" title={$t("Downloaded and verified · ready to play from your Deadwax folder.")} onclick={playSelectedAudio}>{$t("▶ Play")}</button><button class="classic-button" onclick={openNapstrFolder}>{$t("Open folder")}</button>{/if}</div>
              {#if !isLocalFile(selected.fileId)}<div class="detail-actions moderation-actions"><button class="classic-button" onclick={blockSelectedFile}>{$t("Block file")}</button><button class="classic-button" onclick={blockSelectedUser}>{$t("Block user")}</button></div>{/if}
              <section class="track-discussion" aria-label={$t("Discussion for {p0}", { p0: selected.name })}>
                <div class="track-discussion-title"><b>{$t("Track discussion")}</b><small>{$t(trackDiscussionLoading ? "Loading…" : "Public · Nostr")}</small></div>
                <div class="track-discussion-log" use:openChatLog bind:this={trackDiscussionLog} aria-live="polite" aria-busy={trackDiscussionLoading} onscroll={(event) => { if (event.currentTarget.scrollTop < 32) void refreshTrackDiscussion(selected?.fileId, false, true); }}>
                  {#if trackDiscussionLoading && !trackDiscussionMessages.length}<p class="trollbox-notice">{$t("Loading comments…")}</p>{/if}
                  {#if !trackDiscussionLoading && trackDiscussionMessages.length === 0 && !trackDiscussionError}<p class="trollbox-notice">{$t("No comments yet.")}</p>{/if}
                  {#each trackDiscussionMessages as message (message.eventId)}
                    <div class="trollbox-message"><button class="trollbox-name" style:color={chatNameColor(message.npub)} title={$t("Browse songs shared by {p0} · {p1}", { p0: message.displayName, p1: message.npub })} onclick={() => browseUser(message)}>{message.displayName}:</button><span>{message.content}</span>{#if message.npub !== identityNpub}<button class="chat-block" aria-label={$t("Block {p0}", { p0: message.displayName })} onclick={() => blockTrollboxUser(message)}>{$t("Block")}</button>{/if}</div>
                  {/each}
                </div>
                {#if trackDiscussionError}<div class="track-discussion-error">{trackDiscussionError}</div>{/if}
                <div class="track-discussion-compose">
                  <input bind:value={trackDiscussionDraft} maxlength="500" autocomplete="off" placeholder={networkConnected ? $t("Comment on this track…") : $t("Connect to Nostr to comment")} disabled={!networkConnected || trackDiscussionSending} aria-label={$t("Track discussion comment")} onkeydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void sendTrackDiscussionMessage(); } }} />
                  <button class="classic-button primary" type="button" disabled={!networkConnected || trackDiscussionSending || !trackDiscussionDraft.trim()} onclick={() => void sendTrackDiscussionMessage()}>{trackDiscussionSending ? '…' : $t("Send")}</button>
                </div>
              </section>
              {/if}
            {:else}<p class="empty-state">{$t("Select a result to see active seeders.")}</p>{/if}
          </aside>
        </div>
      {:else if activeView === 'Downloads'}
        <section class="full-panel downloads-view">
          <div class="panel-title"><span></span><b>{$t("Transfer Manager")}</b><span></span></div>
          <div class="actionbar"><button class="classic-button" onclick={togglePause}>{paused ? $t("▶ Resume all") : $t("Ⅱ Pause all")}</button><button class="classic-button" onclick={openNapstrFolder}>{$t("Open Deadwax folder")}</button><button class="classic-button" onclick={clearFinishedTransfers} disabled={clearingTransfers || !transfers.some(isFinishedTransfer)}>{$t("Clear finished")}</button><button class="classic-button" onclick={clearAllTransfers} disabled={clearingTransfers || removingTransfers.size > 0 || (!transfers.length && !audiobookDownloads.length && !startingDownloads.size)}>{clearingTransfers ? $t("Clearing…") : $t("Clear all")}</button><div class="spacer"></div><span>{transfers.filter(isActiveTransfer).length} {$t("active ·")} {transfers.filter(isCompleteTransfer).length} {$t("ready to play")}</span></div>
          <div class="download-queue">
            {#each audiobookDownloads as book}
              <div class="audiobook-download-row"><span class="audiobook-glyph">▥</span><b>{book.title}</b><div class="progress"><span style={`width:${book.chapters.length ? (book.nextIndex / book.chapters.length) * 100 : 0}%`}></span><b>{book.nextIndex}/{book.chapters.length}</b></div><span>{book.activeFileId ? $t("Downloading chapter {p0}", { p0: book.nextIndex + 1 }) : $t("Preparing next chapter")}</span></div>
            {/each}
            <table class="file-table download-table"><thead><tr><th>{$t("Download order")}</th><th>{$t("Progress")}</th><th>{$t("Size")}</th><th>{$t("Speed")}</th><th>{$t("Status")}</th><th></th></tr></thead><tbody>
              {#each transfers as transfer}
                <tr class:transfer-complete={isCompleteTransfer(transfer)} ondblclick={() => { if (isCompleteTransfer(transfer)) playAudio(transfer.fileId, transfer.name, playerMode, 'downloads'); }}><td>{transfer.name}</td><td><div class="progress"><span style={`width:${transfer.progress}%`}></span><b>{Math.round(transfer.progress)}%</b></div></td><td>{transfer.size}</td><td>{isCompleteTransfer(transfer) ? $t("Local") : transfer.speed}</td><td>{isCompleteTransfer(transfer) ? $t("Ready to play") : transfer.status}</td><td class="transfer-actions">{#if isCompleteTransfer(transfer)}<button class="classic-button transfer-play" onclick={(event) => { event.stopPropagation(); playAudio(transfer.fileId, transfer.name, playerMode, 'downloads'); }} title={$t("Play verified audio")}>{$t("▶ Play")}</button>{/if}<button class="tiny-button" disabled={clearingTransfers || removingTransfers.has(transfer.id)} onclick={(event) => { event.stopPropagation(); removeTransfer(transfer.id); }} aria-label={$t("Remove transfer: {p0}", { p0: transfer.name })} title={$t("Cancel and clear entry; keep completed audio")}>×</button></td></tr>
              {/each}
            </tbody></table>
            {#if transfers.length === 0}<p class="empty-state compact">{$t("There are no downloads in the queue.")}</p>{/if}
          </div>
        </section>
      {:else if activeView === 'Shared'}
        <section class="full-panel shared-view">
          <div class="panel-title"><span></span><b>{$t("My Shared Files")}</b><span></span></div>
          <div class="actionbar"><button class="classic-button" onclick={indexing ? cancelLibraryScan : rescanSharedFolder}>{indexing ? $t("× Cancel scan") : rescanPending ? $t("… Rescanning") : $t("↻ Rescan")}</button><button class="classic-button" onclick={openNapstrFolder}>{$t("Open folder")}</button><button class="classic-button" onclick={playSelectedSharedAudio} disabled={!selectedShared}>{$t("▶ Play")}</button><button class="classic-button" onclick={playSelectedFolder} disabled={!selectedShared}>{$t("▶ Play folder")}</button><button class="classic-button primary" onclick={playAllSongs} disabled={!sharedFiles.length}>{$t("▶ Play all")}</button><button class="classic-button audiobook-button" onclick={openAudiobookEditor} disabled={libraryFolderView === '*' || audiobookChapters.length < 1}>▥ {folderAudiobook ? $t("Edit audiobook") : $t("Group as audiobook…")}</button><div class="spacer"></div><span>{$t("Sharing")} {sharedFiles.length} {$t("files ·")} {readableSize(indexedBytes)}</span></div>
          <div class="folder-path"><b>{$t("Deadwax folder:")}</b><input value={napstrFolder || 'No folder selected'} readonly /><button class="classic-button" onclick={chooseNapstrFolder}>{$t("Browse…")}</button></div>
          <div class="library-filter">
            <span class="library-filter-label">{$t("View folder:")}</span>
            <div class="folder-picker" use:containLibraryFolderMenu>
              <button type="button" class="folder-picker-toggle" aria-haspopup="listbox" aria-expanded={libraryFolderMenuOpen} onclick={() => (libraryFolderMenuOpen = !libraryFolderMenuOpen)} title={libraryFolderView === '*' ? $t("All folders") : folderName(libraryFolderView)}>
                <span>{libraryFolderView === '*' ? $t("All folders") : folderName(libraryFolderView)}</span><i aria-hidden="true">▼</i>
              </button>
              {#if libraryFolderMenuOpen}
                <div class="folder-picker-menu" role="listbox" aria-label={$t("View folder")}>
                  <button type="button" role="option" aria-selected={libraryFolderView === '*'} class:selected={libraryFolderView === '*'} onclick={() => selectLibraryFolder('*')}>{$t("All folders")}</button>
                  {#each sharedFolders as folder}
                    <button type="button" role="option" aria-selected={libraryFolderView === folder} class:selected={libraryFolderView === folder} onclick={() => selectLibraryFolder(folder)} title={folderName(folder)}>{folderName(folder)}</button>
                  {/each}
                </div>
              {/if}
            </div>
            <span class="library-song-count">{$t("Songs shown: {p0}", { p0: sharedVisible.length })}</span>
          </div>
          {#if !folderAudiobook && libraryFolderView.toLowerCase().includes('audiobook') && audiobookChapters.length >= 1}<div class="audiobook-folder-banner"><span class="audiobook-glyph">▥</span><div><b>{$t("Possible audiobook detected")}</b><small>{$t("Review the natural chapter order before making the collection public.")}</small></div><button class="classic-button primary" onclick={openAudiobookEditor}>{$t("Group as audiobook…")}</button></div>{/if}
          {#if folderAudiobook}<div class="audiobook-folder-banner"><span class="audiobook-glyph">▥</span><div><b>{folderAudiobook?.title}</b><small>{folderAudiobook?.author || $t("Unknown author")} · {folderAudiobook?.chapters.length} {$t("ordered chapters · published as one audiobook")}</small></div><button class="classic-button primary" onclick={() => playAudiobook(folderAudiobook!)}>{$t("▶ Play book")}</button></div>{/if}
          <div class="shared-scroll">
            <table class="file-table shared-table"><thead><tr><th>{$t("Name")}</th><th>{$t("Folder")}</th><th>{$t("Size")}</th><th>{$t("Catalogue")}</th><th>{$t("Active peers")}</th></tr></thead><tbody>{#each sharedRows as file}<tr class:selected={selectedShared?.fileId === file.fileId} onclick={() => selectSharedRow(file)} ondblclick={() => playAudio(file.fileId, file.name, playerMode, 'shared')}><td>{file.name}</td><td>{folderName(file.folder)}</td><td>{file.readableSize}</td><td><span class:amber={!networkConnected} class="led"></span>{networkConnected ? $t("Published") : $t("Indexed")}</td><td>{file.peers}</td></tr>{/each}</tbody></table>
          </div>
          {#if sharedVisible.length > LOCAL_PAGE_SIZE}<div class="results-pager"><button disabled={sharedLibraryPage === 0} onclick={() => changeSharedLibraryPage(sharedLibraryPage - 1)}>{$t("◀ Previous")}</button><span>{$t("Showing {range} of {count} loaded", { range: localPageRange(sharedLibraryPage, sharedVisible.length), count: sharedVisible.length })} · {$t("Page {page} of {pages}", { page: sharedLibraryPage + 1, pages: sharedPageCount })}</span><button disabled={sharedLibraryPage + 1 >= sharedPageCount} onclick={() => changeSharedLibraryPage(sharedLibraryPage + 1)}>{$t("Next ▶")}</button></div>{/if}
          <div class="panel-title"><span></span><b>{$t("Track Tags")}</b><span></span></div>
          <div class="tag-editor">
            <b>{selectedTagFile?.filename ?? $t("Select a track above")}</b>
            <input bind:value={tagDraft} disabled={!selectedTagFile || tagSaving} maxlength="256" placeholder={$t("punk, live, audiobook")} onkeydown={(event) => { if (event.key === 'Enter') saveTags(); }} />
            <button class="classic-button primary" onclick={saveTags} disabled={!selectedTagFile || tagSaving}>{tagSaving ? $t("Saving…") : $t("Save tags")}</button>
            <small>{$t("Comma-separated · published with your signed catalogue")}</small>
          </div>
          <!-- The tag editor above is the only editing that exists yet. This block
               is the shape a full metadata editor will take, drawn from the file
               itself and deliberately inert: the fields are disabled so nobody
               types into something that writes nothing. -->
          <div class="shared-meta" aria-label={$t("File metadata")}>
            <div class="shared-meta-head"><b>{$t("File metadata")}</b><small>{$t("Editing these fields is not built yet.")}</small></div>
            <div class="shared-meta-fields">
              {#each sharedMetaFields(selectedTagFile) as field}
                <label><span>{field.label}</span><input value={field.value} readonly disabled tabindex="-1" /></label>
              {/each}
            </div>
          </div>
          <p class="privacy-note wide"><span>♜</span> {$t("Only validated MP3, FLAC, WAV, Ogg Vorbis, and Opus audio is indexed recursively. Put book folders or complete one-file books inside Audiobooks for automatic grouping. Existing contents are never replaced. Folder names remain local and embedded cover artwork is allowed.")}</p>
        </section>
      {:else if activeView === 'Trollbox'}
        <section class="full-panel trollbox-view">
          <div class="panel-title"><span></span><b>{$t("Deadwax Trollbox")}</b><span></span></div>
          <div class="trollbox-status"><span><i class:amber={!networkConnected} class="led"></i> {$t("Public Nostr chat:")} <b>#napstr-trollbox</b></span><small>{$t(trollboxLoading ? "Loading…" : "NIP-C7 messages are public and signed by your Deadwax Nostr identity.")}</small></div>
          <div class="trollbox-log" use:openChatLog bind:this={trollboxLog} aria-live="polite" aria-busy={trollboxLoading} onscroll={(event) => { if (event.currentTarget.scrollTop < 32) void refreshTrollbox(true); }} aria-label={$t("Deadwax public chat messages")}>
            {#if trollboxLoading && !trollboxMessages.length}<p class="trollbox-notice">{$t("Connecting to the trollbox…")}</p>{/if}
            {#if !trollboxLoading && trollboxMessages.length === 0 && !trollboxError}<p class="trollbox-notice">{$t("No messages yet. Say hello.")}</p>{/if}
            {#each trollboxMessages as message (message.eventId)}
              <div class="trollbox-message"><button class="trollbox-name" style:color={chatNameColor(message.npub)} title={$t("Browse songs shared by {p0} · {p1}", { p0: message.displayName, p1: message.npub })} onclick={() => browseUser(message)}>{message.displayName}:</button><span>{message.content}</span>{#if message.npub !== identityNpub}<button class="chat-block" aria-label={$t("Block {p0}", { p0: message.displayName })} onclick={() => blockTrollboxUser(message)}>{$t("Block")}</button>{/if}</div>
            {/each}
          </div>
          {#if trollboxError}<div class="trollbox-error">{$t(trollboxError)}</div>{/if}
          <div class="trollbox-compose">
            <input bind:value={trollboxDraft} maxlength="500" autocomplete="off" placeholder={networkConnected ? $t("Type a public message…") : $t("Connect to Nostr to chat")} disabled={!networkConnected || trollboxSending} aria-label={$t("Trollbox message")} onkeydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void sendTrollboxMessage(); } }} />
            <button class="classic-button primary" type="button" disabled={!networkConnected || trollboxSending || !trollboxDraft.trim()} onclick={() => void sendTrollboxMessage()}>{trollboxSending ? $t("Sending…") : $t("Send")}</button>
          </div>
        </section>
      {:else if activeView === 'Playlists'}
        <section class="full-panel playlist-view">
          <div class="panel-title playlist-title">
            <span></span><b>{playlistDraft ? $t("Playlist") : $t("Playlists")}</b><span></span>
            <button class="classic-button" title={$t("Refresh")} onclick={() => void refreshPlaylists()}>⟳</button>
            {#if playlistDraft}
              <button class="classic-button" title={$t("Back to playlists")} onclick={closePlaylistEditor}>← {$t("Playlists")}</button>
            {:else}
              <button class="classic-button primary" title={$t("New playlist")} onclick={() => void newPlaylist()}>+ {$t("New playlist")}</button>
            {/if}
          </div>

          {#if playlistsError}<div class="trollbox-error">{$t(playlistsError)}</div>{/if}

          {#if playlistDraft && playlistEditing}
            <div class="playlist-editor">
              <div class="playlist-fields">
                <label>{$t("Title")}
                  <input bind:value={playlistDraft.title} maxlength="256" disabled={!playlistDraftIsMine} />
                </label>
                <label>{$t("Album artist")}
                  <input bind:value={playlistDraft.artist} maxlength="256" disabled={!playlistDraftIsMine} />
                </label>
                <label>{$t("Release group MBID")}
                  <input bind:value={playlistDraft.mbid} maxlength="36" disabled={!playlistDraftIsMine} />
                </label>
                <label>{$t("Search words")}
                  <input bind:value={playlistDraft.tags} maxlength="500" placeholder={$t("Tags")} disabled={!playlistDraftIsMine} />
                </label>
                <p class="playlist-id">{$t("Playlist id")} <code>{playlistDraft.playlistId}</code></p>
                {#if playlistDraft.image}
                  <p class="playlist-id">{$t("Artwork")} <code>{playlistDraft.image}</code>
                    <button class="classic-button" title={$t("Remove")} disabled={!playlistDraftIsMine} onclick={clearPlaylistImage}>×</button>
                  </p>
                {/if}
                <label class="playlist-toggle">
                  <input type="checkbox" bind:checked={playlistSuggestTags} disabled={!playlistDraftIsMine || playlistDraft.tags.trim() !== ''} />
                  <span>{$t("Suggest words from the title")}</span>
                </label>
                {#if playlistDraft.tags.trim() === ''}
                  <p class="privacy-note wide"><span>i</span> {$t("With no words of your own, this playlist is found by its name and its members alone.")}</p>
                {/if}
              </div>

              <div class="playlist-members">
                <div class="playlist-members-head"><b>{$t("Tracks")}</b><span>{playlistMembers.length}</span></div>
                {#each playlistMembers as member, index (member.fileId)}
                  <div
                    class="playlist-member"
                    class:dragging={playlistDragIndex === index}
                    class:drop-target={playlistDragIndex >= 0 && playlistDropIndex === index && playlistDragIndex !== index}
                    role="listitem"
                    draggable={playlistDraftIsMine}
                    ondragstart={(event) => beginPlaylistDrag(index, event)}
                    ondragover={(event) => overPlaylistMember(index, event)}
                    ondrop={() => dropPlaylistMember(index)}
                    ondragend={endPlaylistDrag}
                  >
                    <button
                      type="button"
                      class="playlist-grip"
                      disabled={!playlistDraftIsMine}
                      title={$t("Drag to reorder")}
                      aria-label={$t("Reorder {p0}", { p0: member.title || member.fileId.slice(0, 12) })}
                      onkeydown={(event) => {
                        if (event.key === 'ArrowUp') { event.preventDefault(); movePlaylistMember(index, -1); }
                        if (event.key === 'ArrowDown') { event.preventDefault(); movePlaylistMember(index, 1); }
                      }}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01" /></svg>
                    </button>
                    <span class="playlist-member-position">{index + 1}</span>
                    <div class="playlist-member-copy">
                      <b>{member.title || member.fileId.slice(0, 12)}</b>
                      <small>{member.artist}{member.album ? ` · ${member.album}` : ''}</small>
                    </div>
                    <span class="playlist-badges">
                      {#if !localFileIds.has(member.fileId)}
                        <i class="playlist-badge" title={$t("From the playlist")}>{$t("From the playlist")}</i>
                      {/if}
                      {#if memberAvailability(member.fileId, playlistAvailability, localFileIds)}
                        <i class="playlist-badge" class:amber={!localFileIds.has(member.fileId) && playlistAvailability.get(member.fileId) === 0}>{memberAvailability(member.fileId, playlistAvailability, localFileIds)}</i>
                      {/if}
                    </span>
                    <button class="playlist-row-action playlist-member-remove" title={$t("Remove")} aria-label={$t("Remove {p0}", { p0: member.title || member.fileId.slice(0, 12) })} disabled={!playlistDraftIsMine} onclick={() => removePlaylistMember(index)}>
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.8 7.2h14.4" /><path d="M9.6 7.2V5.4a1.2 1.2 0 0 1 1.2-1.2h2.4a1.2 1.2 0 0 1 1.2 1.2v1.8" /><path d="M6.6 7.2l.9 11.4a1.4 1.4 0 0 0 1.4 1.3h5.8a1.4 1.4 0 0 0 1.4-1.3l.9-11.4" /><path d="M10.2 11v5.4M13.8 11v5.4" /></svg>
                    </button>
                  </div>
                {/each}
                {#if playlistMembers.length === 0}
                  <p class="empty-state compact">{$t("No tracks yet")}</p>
                {/if}
              </div>

              <div class="playlist-add">
                <div class="playlist-members-head"><b>{$t("Add a track")}</b><span></span></div>
                <form class="playlist-track-search" onsubmit={(event) => { event.preventDefault(); void searchPlaylistTracks(); }}>
                  <input bind:value={playlistCandidateQuery} placeholder={$t("Search")} aria-label={$t("Search")} disabled={!playlistDraftIsMine} />
                  <button class="classic-button" type="submit" disabled={!playlistDraftIsMine || playlistSearching}>{$t("Search")}</button>
                </form>
                <div class="playlist-candidates">
                  {#each playlistCandidates as candidate (candidate.fileId)}
                    <div class="playlist-candidate">
                      <div class="playlist-member-copy">
                        <b>{candidate.title || candidate.filename}</b>
                        <small>{candidate.artist}{candidate.album ? ` · ${candidate.album}` : ''}</small>
                      </div>
                      {#if candidate.source === 'network'}
                        <i class="playlist-badge" title={$t("Not on this computer")}>{$t("Not on this computer")}</i>
                      {/if}
                      <button class="classic-button" disabled={!playlistDraftIsMine || playlistMembers.some((member) => member.fileId === candidate.fileId)} onclick={() => addPlaylistMember(candidate)}>{$t("Add")}</button>
                    </div>
                  {/each}
                </div>
              </div>

              <div class="playlist-actions">
                <button class="classic-button primary" disabled={playlistSaving || !playlistDraft.title.trim()} onclick={() => void savePlaylist()}>{playlistSaving ? $t("Saving…") : playlistDraftIsMine ? $t("Save") : $t("Save a copy")}</button>
                {#if playlistDraftIsMine}
                  <button class="classic-button" title={$t("Publish")} disabled={playlistSaving || !playlistDraft.title.trim()} onclick={() => void publishPlaylist()}>{$t("Publish")}</button>
                  <button class="classic-button playlist-delete" title={$t("Delete")} disabled={playlistSaving} onclick={() => void deletePlaylist(playlistDraft)}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.8 7.2h14.4" /><path d="M9.6 7.2V5.4a1.2 1.2 0 0 1 1.2-1.2h2.4a1.2 1.2 0 0 1 1.2 1.2v1.8" /><path d="M6.6 7.2l.9 11.4a1.4 1.4 0 0 0 1.4 1.3h5.8a1.4 1.4 0 0 0 1.4-1.3l.9-11.4" /><path d="M10.2 11v5.4M13.8 11v5.4" /></svg>
                    {$t("Delete")}
                  </button>
                {/if}
                {#if playlistNotice}<span class="playlist-notice">{$t(playlistNotice)}</span>{/if}
                {#if playlistError}<span class="playlist-error">{$t(playlistError)}</span>{/if}
              </div>
            </div>
          {:else}
            <div class="split-content playlist-split">
              <section class="playlist-browse" aria-label={$t("Playlists")}>
                <div class="section-caption">
                  <span>{playlists.length} {$t("Playlists")}</span>
                  <div class="results-caption-tools">
                    <button type="button" class="view-toggle" class:active={playlistView === 'list'} title={$t("Show these as a list")} aria-pressed={playlistView === 'list'} onclick={() => setPlaylistView('list')}>▤</button>
                    <button type="button" class="view-toggle" class:active={playlistView === 'grid'} title={$t("Show these as tiles")} aria-pressed={playlistView === 'grid'} onclick={() => setPlaylistView('grid')}>▦</button>
                  </div>
                </div>
                {#if playlistView === 'grid'}
                  <div class="result-grid playlist-grid" aria-label={$t("Playlists as tiles")}>
                    {#each [...playlistTiers.mine, ...playlistTiers.theirs] as row (playlistKey(row))}
                      <button type="button" class="result-card" class:selected={selectedPlaylistKey === playlistKey(row)} aria-pressed={selectedPlaylistKey === playlistKey(row)} onclick={() => void openPlaylist(row)}>
                        <span class="result-art">
                          {#if playlistArtOf(row)}<CoverArt artist={playlistArtOf(row)!.artist} album={playlistArtOf(row)!.album} preferThumb size="medium" revision={coverRevision} />{:else}<span class="cover-art medium empty" aria-hidden="true">♪</span>{/if}
                          <span class="result-overlay">
                            <b title={row.title}>{row.title}</b>
                            <small>{row.trackCount} {$t("Tracks")} · {playlistOwner(row)}</small>
                          </span>
                        </span>
                      </button>
                    {/each}
                    {#if playlistsLoading}<p class="empty-state compact">···</p>{:else if playlists.length === 0}<p class="empty-state compact">{$t("No playlists yet")}</p>{/if}
                  </div>
                {:else}
                  <div class="playlist-list">
                    {#if playlistTiers.mine.length > 0}
                      <p class="playlist-group">{$t("Your playlists")}</p>
                    {/if}
                    {#each playlistTiers.mine as row (playlistKey(row))}
                      <div class="playlist-row" class:selected={selectedPlaylistKey === playlistKey(row)}>
                        <button class="playlist-open" title={$t("Show this playlist")} onclick={() => void openPlaylist(row)}>
                          <b>{row.title}</b>
                          <small>{row.trackCount} {$t("Tracks")} · {playlistOwner(row)}</small>
                        </button>
                        <span class="playlist-badges">
                          {#if row.state === 'relays'}
                            <i class="playlist-badge">{$t("On the relays only")}</i>
                          {:else if row.state === 'local'}
                            <i class="playlist-badge" title={$t("This is published, so it will be withdrawn from the relays as well.")}>{$t("Only on this computer")}</i>
                          {:else if row.state === 'draft'}
                            <i class="playlist-badge">{$t("Draft")}</i>
                          {:else}
                            <i class="playlist-badge">{$t("Held locally")}</i>
                            <i class="playlist-badge">{row.published ? $t("Published") : $t("Draft")}</i>
                          {/if}
                        </span>
                        {#if row.state === 'relays'}
                          <button class="classic-button" disabled={playlistSaving} onclick={() => void restorePlaylist(row)}>{$t("Restore")}</button>
                        {:else}
                          <button class="classic-button" title={row.withdrawable ? $t("Withdraw") : $t("Delete")} disabled={playlistSaving} onclick={() => void deletePlaylist(row)}>×</button>
                        {/if}
                      </div>
                    {/each}

                    {#if playlistTiers.theirs.length > 0}
                      <p class="playlist-group">{$t("From everyone else")}</p>
                    {/if}
                    {#each playlistTiers.theirs as row (playlistKey(row))}
                      <div class="playlist-row" class:selected={selectedPlaylistKey === playlistKey(row)}>
                        <button class="playlist-open" title={$t("Show this playlist")} onclick={() => void openPlaylist(row)}>
                          <b>{row.title}</b>
                          <small>{row.trackCount} {$t("Tracks")} · {playlistOwner(row)}</small>
                        </button>
                        <span class="playlist-badges"><i class="playlist-badge">{$t("Read-only")}</i></span>
                        <span></span>
                      </div>
                    {/each}

                    {#if playlistsLoading}
                      <p class="empty-state compact">···</p>
                    {:else if playlistTiers.mine.length === 0 && playlistTiers.theirs.length === 0}
                      <p class="empty-state compact">{$t("No playlists yet")}</p>
                    {/if}
                  </div>
                {/if}
              </section>

              <aside class="details-pane playlist-side" aria-label={$t("Playlist details")}>
                {#if playlistDraft}
                  <div class="detail-hero playlist-hero">
                    {#if selectedPlaylistArt}<CoverArt artist={selectedPlaylistArt.artist} album={selectedPlaylistArt.album} preferThumb size="large" revision={coverRevision} />{:else}<span class="cover-art large empty" aria-hidden="true">♪</span>{/if}
                    <span class="detail-hero-scrim" aria-hidden="true"></span>
                    <span class="detail-hero-text">
                      <b title={playlistDraft.title}>{playlistDraft.title || $t("Untitled playlist")}</b>
                      <small>{playlistDraftIsMine ? $t("Yours") : playlistOwner(playlistDraft)}</small>
                      <span class="detail-hero-meta">{$t("{p0} tracks", { p0: playlistMembers.length })}</span>
                    </span>
                  </div>
                  <div class="playlist-side-actions">
                    <button class="classic-button primary" disabled={!playlistHasLocalTracks} onclick={playPlaylist} title={playlistHasLocalTracks ? $t("Play the tracks of this playlist that are on this computer") : $t("None of this playlist is on this computer yet")}>{$t("▶ Play")}</button>
                    {#if playlistDraftIsMine}
                      <button class="classic-button" onclick={() => (playlistEditing = true)}>{$t("Edit")}</button>
                      {#if !playlistDraft.published}<button class="classic-button" disabled={playlistSaving || !playlistDraft.title.trim()} onclick={() => void publishPlaylist()}>{$t("Publish")}</button>{/if}
                    {:else}
                      <button class="classic-button" title={$t("Save your own copy of this playlist")} onclick={() => (playlistEditing = true)}>{$t("Copy")}</button>
                    {/if}
                  </div>
                  <div class="playlist-side-members">
                    {#each playlistMembers.slice(0, 60) as member}
                      <div class="playlist-side-member">
                        <span class="playlist-member-position">{member.position}</span>
                        <div class="playlist-member-copy">
                          <b>{member.title || member.fileId.slice(0, 12)}</b>
                          <small>{member.artist}{member.album ? ` · ${member.album}` : ''}</small>
                        </div>
                        {#if localFileIds.has(member.fileId)}<i class="playlist-badge">{$t("On this computer")}</i>{:else}<i class="playlist-badge">{memberAvailability(member.fileId, playlistAvailability, localFileIds) ?? $t("From the playlist")}</i>{/if}
                      </div>
                    {/each}
                    {#if playlistMembers.length === 0}<p class="empty-state compact">{$t("No tracks yet")}</p>{/if}
                    {#if playlistMembers.length > 60}<p class="empty-state compact">{$t("{p0} more tracks", { p0: playlistMembers.length - 60 })}</p>{/if}
                  </div>
                {:else}
                  <p class="empty-state">{$t("Choose a playlist to see it here.")}</p>
                {/if}
              </aside>
            </div>
          {/if}
        </section>
      {:else if activeView === 'Covers'}
        <section class="full-panel cover-scan-view">
          <div class="panel-title" title={$t("Deadwax finds album art in two steps. Reading the kind") + ' 30427 ' + $t("claims other people published needs nothing switched on: it is an ordinary relay query, and it happens by itself as results appear. The two switches below are the steps that leave Deadwax. Deadwax acts on them on its own — there is nothing else to press — and they are stored, so leaving one on means it carries on after a restart.")}><span></span><b>{$t("Album covers")}</b><span></span></div>

          <!--
            Everything a person comes here for, in one line: what is held, how
            much disk it takes, and what is left to fetch. The panels below it are
            one at a time, because six panels stacked with a paragraph under each
            is a wall rather than a page.
          -->
          <div
            class="cover-summary"
            title={'Albums the worker is dealing with, pictures this computer holds for your phones and what they take on disk, albums whose pictures it has not fetched yet, and albums of your own music with no cover claim. Everything long-winded about this tab is in a tooltip on the thing it is about.'}
          >
            <span>{#if coverStatus?.running}<b>{(coverStatus?.remaining ?? 0).toLocaleString()}</b>{' of '}{(coverStatus?.pending ?? 0).toLocaleString()}{' this pass'}{:else}<b>{(coverStatus?.pending ?? 0).toLocaleString()}</b>{' in the last pass'}{/if}</span>
            <span><b>{(coverStatus?.artCached ?? 0).toLocaleString()}</b>{' '}{(coverStatus?.artCached ?? 0) === 1 ? 'picture' : 'pictures'}</span>
            <span>{readableBytes(coverStatus?.artBytes ?? 0)}</span>
            <span><b>{(coverStatus?.artPending ?? 0).toLocaleString()}</b>{' '}{(coverStatus?.artPending ?? 0) === 1 ? 'album' : 'albums'}{' to fetch'}</span>
            <span><b>{coverMissing.length.toLocaleString()}</b>{' '}{coverMissing.length === 1 ? 'album' : 'albums'}{' without a claim'}</span>
            {#if coverStatus?.current}<span class="cover-summary-current" title={$t("Working on")}>{coverStatus.current}</span>{/if}
            <button class="cover-summary-refresh" onclick={() => void refreshCovers()} disabled={coverLoading} title={$t("Refresh")}>{coverLoading ? '…' : '⟳'}</button>
          </div>

          <div class="cover-subtabs" role="group" aria-label={$t("Sort the album list")}>
            {#each coverSorts as option}
              <button class="cover-subtab" class:active={coverSort === option.id} aria-pressed={coverSort === option.id} onclick={() => setCoverSort(option.id)}>{$t(option.label)}</button>
            {/each}
          </div>

          <div class="cover-panel-body">
            <div class="cover-panel-head">
              <b>{$t("Every album this computer knows")}</b>
              <span>{$t("What it holds, what it went and found, and who signed the picture it uses.")}</span>
            </div>
            {#if coverInventory.rows.length > 0}
              <div class="table-wrap">
                <table class="file-table cover-table">
                  <thead><tr><th>{$t("Album")}</th><th>{$t("Picture")}</th><th>{$t("Signed by")}</th><th>{$t("Last try")}</th></tr></thead>
                  <tbody>
                  {#each coverInventory.rows as row (row.key)}
                    <tr>
                      <td><b>{row.album || row.key}</b><small>{row.artist}</small></td>
                      <td><i class="playlist-badge" class:amber={!row.held && Boolean(row.reason)}>{$t(coverRowState(row))}</i></td>
                      <td>{#if row.signedBy}<code title={row.signedBy}>{shortKey(row.signedBy)}</code>{:else}<span class="cover-dash">—</span>{/if}</td>
                      <td><small title={row.reason}>{row.reason || '—'}</small></td>
                    </tr>
                  {/each}
                </tbody>
                </table>
              </div>
            {/if}
            {#if !coverLoading && coverInventory.rows.length === 0}<p class="empty-state compact">{$t("Nothing here yet.")}</p>{/if}
            <div class="results-pager">
              <button disabled={coverPageIndex === 0 || coverLoading} onclick={() => changeCoverPage(coverPageIndex - 1)}>{$t("◀ Previous")}</button>
              <span>{$t("Page {page} of {pages}", { page: coverPageIndex + 1, pages: Math.max(1, Math.ceil(coverInventory.total / COVER_PAGE_SIZE)) })}{' · '}{$t("{p0} albums", { p0: coverInventory.total.toLocaleString() })}</span>
              <button disabled={coverLoading || (coverPageIndex + 1) * COVER_PAGE_SIZE >= coverInventory.total} onclick={() => changeCoverPage(coverPageIndex + 1)}>{$t("Next ▶")}</button>
            </div>
          </div>

          <div class="cover-panel-body">
            <div class="cover-panel-head">
              <b>{$t("The last pass")}</b>
              <span>{$t("Every attempt it made, newest first, and the reason each one has.")}</span>
            </div>
            {#if coverStatus}
              <div class="cover-scan-status">
                <span><b>{coverStatus.published}</b> {$t("published")}</span>
                <span><b>{coverStatus.resolved}</b> {$t("resolved, not signed")}</span>
                <span><b>{coverStatus.alreadyCovered}</b> {$t("covered by others")}</span>
                <span><b>{coverStatus.noArt}</b> {$t("no art anywhere")}</span>
                {#if coverStatus.failed}<span><b>{coverStatus.failed}</b> {$t("failed")}</span>{/if}
                {#if coverStatus.backedOff}<span><b>{coverStatus.backedOff}</b> {$t("throttled waits")}</span>{/if}
              </div>
              {#if coverStatus.message}<p class="cover-scan-message">{coverStatus.message}</p>{/if}
            {/if}
            <div id="cover-log-list" class="cover-log-list">
              {#each coverLog as line (line.at + line.key + line.outcome)}
                <div class="cover-log-line">
                  <time>{coverLogTime(line.at)}</time>
                  <span class:cover-gap-failed={line.outcome === 'failed'} class:cover-log-throttled={line.outcome === 'throttled' || line.outcome === 'slow'} class="cover-log-outcome">{line.outcome}</span>
                  <span class="cover-log-album">{line.album}{line.artist ? ` — ${line.artist}` : ''}</span>
                  {#if line.source}<span class="cover-log-source">{line.source}</span>{/if}
                  {#if line.message}<small class="cover-gap-note" title={line.message}>{line.message}</small>{/if}
                </div>
              {/each}
              {#if !coverLoading && coverLog.length === 0}
                <p class="empty-state compact">{'No lookups have run yet.'}</p>
              {/if}
            </div>
          </div>

          {#if coverError}<div class="trollbox-error">{coverError}</div>{/if}
        </section>
      {:else if activeView === 'Clients'}
        <section class="full-panel mobile-connect-view">
          <div class="panel-title"><span></span><b>{$t("Clients")}</b><span></span></div>
          <div class="mobile-connect-status">
            <span><i class:amber={!mobileStatusValue?.online} class:error={Boolean(mobileStatusValue?.error)} class="led"></i><b>{mobileStatusValue?.online ? $t("Iroh ready") : mobileStatusValue?.running ? $t("Iroh connecting…") : $t("Iroh unavailable")}</b></span>
            <small>{$t("Deadwax stays in control of discovery and Tor downloads.")}</small>
          </div>
          {#if mobileError}<div class="trollbox-error">{$t(mobileError)}</div>{/if}
          {#if clientNote}<div class="client-note">{clientNote}</div>{/if}
          <div class="mobile-connect-grid">
            <section class="pair-phone-card">
              <h2>{$t("Pair a client")}</h2>
              <p>{$t("Scan in")} <a href="https://deadwax.rip/mobile.html" onclick={openNapstrfyWebsite}>Deadwax</a>{$t(". Keep Deadwax open while streaming.")}</p>
              {#if mobileStreamPairing}
                <div class="pairing-qr" aria-label={$t("Read-only Deadwax pairing QR code")}>{@html mobileStreamPairing.qrSvg}</div>
                <p class="pairing-expiry">{$t("One use · expires")} {new Date(mobileStreamPairing.expiresAt * 1000).toLocaleTimeString($locale, { hour: '2-digit', minute: '2-digit' })}</p>
                <details><summary>{$t("Pair without a camera")}</summary><textarea readonly value={mobileStreamPairing.ticket} aria-label={$t("Manual read-only pairing code")}></textarea></details>
                <button class="classic-button" onclick={() => createMobilePairing(true)} disabled={mobileLoading}>{mobileLoading ? $t("Preparing…") : $t("Create a new code")}</button>
              {:else}
                <button class="classic-button primary" onclick={() => createMobilePairing(true)} disabled={mobileLoading}>{mobileLoading ? $t("Preparing Iroh…") : $t("Create pairing code")}</button>
                <div class="pairing-placeholder"><span>▦</span><b>{$t("Your one-use QR code will appear here")}</b></div>
              {/if}
              <p class="privacy-note wide"><span>i</span> {$t("The QR secret is random, expires after five minutes, and is invalidated by the first successful pairing. Removing a client immediately revokes future connections. Deadwax makes a private, encrypted tunnel from your phone to this computer, only for your own use and for people you trust.")}</p>
            </section>
            <section class="paired-devices-card">
              <h2>{$t("Paired clients")}</h2>
              <p>{$t("Each client keeps the access its code gave it, and you can change it here at any time.")}</p>
              <div class="paired-device-list">
                {#each mobileStatusValue?.devices ?? [] as device (device.endpointId)}
                  <div class="paired-device-block">
                    <div class="paired-device">
                      <span class="phone-glyph">▯</span>
                      <!-- The switches below are what this client may do, so the row
                           does not also summarise it: "read only" was already
                           untrue of a device lent the index alone. -->
                      <div>
                        <b>{device.name}</b>
                        <small>{$t("Last connected")} {mobileLastSeen(device.lastSeen)}</small>
                        <code title={device.endpointId}>{device.endpointId}</code>
                      </div>
                      <button class="classic-button" onclick={() => revokeMobileDevice(device)}>{$t("Remove")}</button>
                    </div>
                    <div class="device-facts">
                      <span class="playlist-badge">{device.likes} {$t("likes")}</span>
                      <span class="playlist-badge">{device.dislikes} {$t("dislikes")}</span>
                      <span class="playlist-badge">{device.playlists} {$t("Playlists")}</span>
                      <span class="playlist-badge" title={device.pubkey}>{device.pubkey ? shortKey(device.pubkey) : $t("No key proved")}</span>
                      <span class="playlist-badge">{$t("Paired")} {new Date(device.pairedAt).toLocaleDateString($locale)}</span>
                    </div>
                    <div class="device-transfer">
                      <button class="classic-button" title={$t("Save this client’s likes and dislikes to a file")} disabled={mobileLoading} onclick={() => void backupClientData(device)}>{$t("Backup…")}</button>
                      <button class="classic-button" title={$t("Put likes and dislikes back from a file")} disabled={mobileLoading} onclick={() => void restoreClientData(device)}>{$t("Restore…")}</button>
                      <small>{$t("A backup holds the marks and playlists this client made here, and nothing that lets it connect.")}</small>
                    </div>
                    <div class="device-rights" role="group" aria-label={$t("What {p0} may do", { p0: device.name })}>
                      {#each deviceRightChoices() as choice}
                        <label class:on={device.rights[choice.key]}>
                          <input
                            type="checkbox"
                            checked={device.rights[choice.key]}
                            disabled={mobileLoading}
                            onchange={(event) => void setDeviceRight(device, choice.key, event.currentTarget.checked)}
                          />
                          <span>{choice.label}</span>
                        </label>
                      {/each}
                    </div>
                  </div>
                {/each}
                {#if (mobileStatusValue?.devices.length ?? 0) === 0}<p class="empty-state compact">{$t("No clients are paired yet.")}</p>{/if}
              </div>
            </section>
          </div>
        </section>
      {:else if activeView === 'Network'}
        <section class="full-panel network-view">
          <header class="net-head">
            <div>
              <h2>{$t("Network")}</h2>
              <p>{$t("What this computer can see of the catalogue")}</p>
            </div>
            <button class="net-refresh" onclick={() => void refreshCatalogueStats()} disabled={catalogueStatsPending}>
              {catalogueStatsPending ? $t("Reading…") : $t("Refresh")}
            </button>
          </header>
          {#if catalogueStatsError}<p class="net-error">{$t(catalogueStatsError)}</p>{/if}
          {#if catalogueStats}
            {@const behind = catalogueStats.indexed < catalogueStats.announced}
            <div class="net-kpis">
              <article class="net-kpi live">
                <span class="net-label">{$t("Playable now")}</span>
                <b class="net-value">{counted(catalogueStats.liveFiles)}</b>
                <span class="net-under">{$t("{p0} ever announced", { p0: counted(catalogueStats.announced) })}</span>
              </article>
              <article class="net-kpi live">
                <span class="net-label">{$t("Seeders online")}</span>
                <b class="net-value">{counted(catalogueStats.livePeers)}</b>
                <span class="net-under">{$t("{p0} have ever announced", { p0: counted(catalogueStats.publishers) })}</span>
              </article>
              <article class="net-kpi">
                <span class="net-label">{$t("Your library")}</span>
                <b class="net-value">{counted(catalogueStats.held)}</b>
              </article>
              <article class="net-kpi" class:behind>
                <span class="net-label">{$t("Searchable")}</span>
                <b class="net-value">{counted(catalogueStats.indexed)}</b>
                <span class="net-under">{$t("of {p0} described", { p0: counted(catalogueStats.announced) })}</span>
              </article>
            </div>
            {#if behind}
              <p class="net-warn">{$t("The index is behind the mirror, so a search may be missing something.")}</p>
            {/if}
            <div class="net-columns">
              <section class="net-panel">
                <h3>{$t("Formats")}</h3>
                {#each catalogueStats.formats as format}
                  <div class="net-bar-row">
                    <span class="net-bar-label">{format.label}</span>
                    <span class="net-bar-track"><i style={`width: ${Math.max(2, Math.round((format.count / Math.max(1, catalogueStats.formats[0]?.count ?? 1)) * 100))}%`}></i></span>
                    <span class="net-bar-value">{counted(format.count)}</span>
                  </div>
                {/each}
                {#if catalogueStats.formats.length === 0}<p class="net-empty">{$t("Nothing is playable right now.")}</p>{/if}
              </section>
              <section class="net-panel">
                <h3>{$t("Busiest artists")}</h3>
                {#each catalogueStats.artists as artist}
                  <div class="net-bar-row">
                    <span class="net-bar-label" title={artist.label}>{artist.label}</span>
                    <span class="net-bar-track"><i style={`width: ${Math.max(2, Math.round((artist.count / Math.max(1, catalogueStats.artists[0]?.count ?? 1)) * 100))}%`}></i></span>
                    <span class="net-bar-value">{counted(artist.count)}</span>
                  </div>
                {/each}
                {#if catalogueStats.artists.length === 0}<p class="net-empty">{$t("Nothing is playable right now.")}</p>{/if}
              </section>
            </div>
            <section class="net-panel net-publishers">
              <div class="net-panel-head">
                <h3>{$t("Seeders")}</h3>
                <label class="net-toggle">
                  <input type="checkbox" bind:checked={showQuietSeeders} onchange={() => { seederPageIndex = 0; void refreshSeeders(); }} />
                  <span>{$t("Show quiet seeders")}</span>
                </label>
              </div>
              {#if seederError}<p class="net-error">{$t(seederError)}</p>{/if}
              <table>
                <thead><tr><th>{$t("Seeder")}</th><th class="num">{$t("Live")}</th><th class="num">{$t("Announced")}</th></tr></thead>
                <tbody>
                  {#each seedersPage.rows as seeder (seeder.pubkey)}
                    <tr>
                      <td><button class="user-name seeder-name" title={seeder.npub || seeder.pubkey} onclick={() => browseUser({ pubkey: seeder.pubkey, npub: seeder.npub, displayName: seederLabel(seeder) })}>{seederLabel(seeder)}</button>{#if seeder.name}<code class="seeder-key" title={seeder.npub}>{shortKey(seeder.npub || seeder.pubkey)}</code>{/if}</td>
                      <td class="num" class:quiet={seeder.live === 0}>{counted(seeder.live)}</td>
                      <td class="num">{counted(seeder.announced)}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
              {#if seedersPage.rows.length === 0}<p class="net-empty">{$t("No seeders on this page.")}</p>{/if}
              <div class="net-pager">
                <button onclick={() => changeSeederPage(seederPageIndex - 1)} disabled={seederPageIndex === 0 || seedersPending}>{$t("Previous")}</button>
                <span>{$t("Page {p0} of {p1}", { p0: seederPageIndex + 1, p1: Math.max(1, Math.ceil(seedersPage.total / SEEDER_PAGE_SIZE)) })}{' · '}{$t("{p0} seeders", { p0: counted(seedersPage.total) })}</span>
                <button onclick={() => changeSeederPage(seederPageIndex + 1)} disabled={seedersPending || (seederPageIndex + 1) * SEEDER_PAGE_SIZE >= seedersPage.total}>{$t("Next")}</button>
              </div>
            </section>
            <footer class="net-foot">
              <span>{$t("Last mirror write {p0}", { p0: mirrorWritten(catalogueStats.lastWrite) })}</span>
              <span>{$t("These are this computer's own counts, not the network's totals.")}</span>
            </footer>
          {:else if !catalogueStatsPending}
            <p class="net-empty">{$t("No figures yet.")}</p>
          {/if}
        </section>
      {:else if activeView === 'Profile'}
        <section class="full-panel profile-view">
          <div class="panel-title"><span></span><b>{$t("Deadwax Profile")}</b><span></span></div>
          <div class="profile-card"><div class="avatar"><img src="/deadwax-logo-mark.png" alt={$t("Deadwax mascot")} /></div><div><h2><button class="user-name" disabled={!identityNpub} onclick={() => browseUser(ownCatalogueUser())}>{displayName}</button></h2><p>{$t("Your dedicated Deadwax Nostr identity.")}</p><code>{identityNpub || $t("Connect to create identity")}</code><div class="profile-stats"><span><b>{sharedFiles.length}</b> {$t("shared files")}</span><span><b>{transfers.filter(isCompleteTransfer).length}</b> {$t("downloads kept")}</span><span><b>{networkConnected ? $t("Nostr online") : $t("Offline")}</b></span></div></div></div>
          <p class="privacy-note wide"><span>!</span> {$t("Use a pseudonym. This name is published with everything you share, and nothing here ties it to who you are unless you write that down yourself.")}</p>
          <fieldset class="edit-profile"><legend>{$t("Profile")}</legend><label>{$t("Display name")} <input bind:value={displayName} /></label><label>{$t("About")} <input bind:value={profileAbout} /></label><label>{$t("Picture URL")} <input bind:value={profilePicture} placeholder="https://…" /></label><button class="classic-button primary" onclick={persistSettings}>{$t("Save profile")}</button></fieldset>
          <p class="privacy-note wide"><span>i</span> {$t("Your profile and shared catalogue are public on Nostr. Transfer addresses and credentials are never published.")}</p>
        </section>
      {:else}
        <section class="full-panel settings-view">
          <div class="panel-title"><span></span><b>{$t("Deadwax Settings")}</b><span></span></div>
          <fieldset><legend>{$t("Language")}</legend><LanguageSelect /><small>{$t("Saved automatically on this device.")}</small></fieldset>
          <fieldset><legend>{$t("Network")}</legend><label><input type="checkbox" checked disabled /> {$t("Connect automatically at startup")}</label><label>{$t("Nostr relays")} <input bind:value={nostrRelays} /></label><label>Tor <input value={$t("Bundled, managed automatically")} readonly /></label></fieldset>
          <fieldset><legend>{$t("Files")}</legend><label>{$t("Downloads and shared audio")} <input value={napstrFolder} readonly /><button class="classic-button" onclick={chooseNapstrFolder}>{$t("Browse…")}</button></label><label>{$t("Transfer mode")} <select disabled><option>{$t("Whole file")}</option></select></label><label><input type="checkbox" checked disabled /> {$t("Downloaded audio is automatically shared")}</label><label><input type="checkbox" checked disabled /> {$t("Verify the complete file with SHA-256")}</label></fieldset>
          <fieldset class="cover-settings"><legend>{$t("Album art")}</legend>
            <label class="settings-switch"><input type="checkbox" checked={coverStatus?.lookupExternal ?? false} onchange={(event) => void setCoverPreferences(event.currentTarget.checked, coverStatus?.publishClaims ?? false)} /><span>{$t("Look up art automatically")}<small>{$t("Asks MusicBrainz and the Cover Art Archive about every album without a cover, and the iTunes catalogue when those have nothing.")}</small></span></label>
            <label class="settings-switch"><input type="checkbox" checked={coverStatus?.publishClaims ?? false} onchange={(event) => void setCoverPreferences(coverStatus?.lookupExternal ?? false, event.currentTarget.checked)} /><span>{$t("Sign and publish the covers I resolve")}<small>{$t("Sends a claim signed with your own identity to your relays.")}</small></span></label>
            <label class="settings-hosts">{$t("Art domains to accept")}
              <textarea id="cover-art-hosts" rows="3" spellcheck="false" placeholder={'coverartarchive.org\narchive.org\nmzstatic.com'} bind:value={allowedArtHosts}></textarea>
              <small>{$t("One per line. Empty means any HTTPS host.")}</small>
            </label>
            <div class="cover-art-hosts-actions">
              <button class="classic-button primary" disabled={allowedArtHosts === allowedArtHostsSaved} onclick={() => void saveAllowedArtHosts(allowedArtHosts)}>{$t("Save list")}</button>
              <button class="classic-button" onclick={() => void saveAllowedArtHosts(RECOMMENDED_ART_HOSTS.join('\n'))}>{$t('Use the recommended list')}</button>
              <button class="classic-button" onclick={() => void saveAllowedArtHosts('')}>{$t('Accept any host')}</button>
              <button class="classic-button" onclick={() => void setArtPaused(!coverStatus?.artPaused)}>{coverStatus?.artPaused ? $t('Resume fetching') : $t('Pause fetching')}</button>
              <button class="classic-button" disabled={(coverStatus?.artCached ?? 0) === 0} onclick={() => void clearArtCache()}>{$t('Clear the held pictures')}</button>
            </div>
            <small class="settings-note">{$t("{p0} pictures held, using {p1}.", { p0: (coverStatus?.artCached ?? 0).toLocaleString(), p1: readableBytes(coverStatus?.artBytes ?? 0) })}</small>
          </fieldset>
          <div class="settings-actions"><button class="classic-button primary" onclick={persistSettings}>{$t("OK")}</button><button class="classic-button" onclick={refreshSnapshot}>{$t("Cancel")}</button><button class="classic-button" onclick={persistSettings}>{$t("Apply")}</button></div>
        </section>
      {/if}
    </div>

    <footer class="statusbar"><span class="prompt">›</span><span class="status-message">{$t(activityMessage)}</span><span class="grow"></span><span class="status-clock">{new Intl.DateTimeFormat($locale, { hour: '2-digit', minute: '2-digit' }).format(clockNow)}</span></footer>

    <section class="player-bar" aria-label={$t("Deadwax audio player")}>
      <div class="player-display">
        <div class="player-art" class:playing={playerPlaying}>
          {#if currentTrack}<CoverArt artist={currentTrack.artist ?? ''} album={playerAlbum} preferThumb size="small" revision={coverRevision} />{:else}<span aria-hidden="true">♪</span>{/if}
        </div>
        <div class="player-copy">
          <strong title={currentTrack?.name}>{currentTrack?.name ?? $t("No track selected")}</strong>
          <small title={currentTrack ? `${currentTrack.artist || 'Unknown artist'} · ${folderName(currentTrack.folder)}` : undefined}>{currentTrack ? `${currentTrack.artist || 'Unknown artist'} · ${folderName(currentTrack.folder)}` : $t("Choose a local song to begin")}</small>
        </div>
      </div>
      <div class="player-controls">
        <button class="player-step" onclick={previousPlayerTrack} disabled={!currentTrack || playerLoading} title={$t("Previous track")} aria-label={$t("Previous track")}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 5v14" /><path d="M18 5.6 9.4 12l8.6 6.4z" /></svg>
        </button>
        <button class="player-primary" onclick={togglePlayer} disabled={playerLoading} title={playerPlaying ? $t("Pause") : $t("Play")} aria-label={playerPlaying ? $t("Pause") : $t("Play")}>
          {#if playerLoading}<span class="search-spinner" aria-hidden="true"></span>{:else if playerPlaying}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5.5v13M15 5.5v13" /></svg>{:else}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.4 18.6 12 8 18.6z" /></svg>{/if}
        </button>
        <button class="player-step" onclick={nextPlayerTrack} disabled={playerLoading || playerQueueIndex < 0 || playerQueueIndex + 1 >= playerQueue.length} title={$t("Next track")} aria-label={$t("Next track")}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.5 5v14" /><path d="M6 5.6 14.6 12 6 18.4z" /></svg>
        </button>
        <button class="player-step player-stop" onclick={stopPlayer} disabled={!currentTrack || playerLoading} title={$t("Stop")} aria-label={$t("Stop")}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.6" /></svg>
        </button>
      </div>
      <div class="player-seek">
        <span class="player-time">{formatPlayerTime(playerCurrentTime)}</span>
        <input aria-label={$t("Track position")} type="range" min="0" max={Math.max(0, playerDuration || 0)} step="0.1" value={playerCurrentTime} oninput={seekPlayer} disabled={!currentTrack} style={`--fill: ${playerDuration ? (playerCurrentTime / playerDuration) * 100 : 0}%`} />
        <span class="player-time">{formatPlayerTime(playerDuration)}</span>
      </div>
      <div class="player-extras">
        <label class="player-volume" title={$t("Volume")}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.8 9.4h3L12 5.6v12.8l-4.2-3.8h-3z" /><path d="M15.4 9.2a4 4 0 0 1 0 5.6M17.8 6.8a7.4 7.4 0 0 1 0 10.4" /></svg>
          <input aria-label={$t("Volume")} type="range" min="0" max="1" step="0.05" value={playerVolume} oninput={changePlayerVolume} style={`--fill: ${playerVolume * 100}%`} />
        </label>
        <label class="player-mode" title={$t("After track")}>
          <select bind:value={playerMode} onchange={changePlayerMode} aria-label={$t("After track")}>
            <option value="single">{$t("Stop")}</option>
            <option value="folder">{$t("Play folder")}</option>
            <option value="all">{$t("Play all")}</option>
          </select>
        </label>
      </div>
    </section>
    </div>
  </section>

  {#if coverPicker}
    <CoverPicker
      artist={coverPicker.artist}
      album={coverPicker.album}
      currentArt={coverPicker.currentArt}
      onClose={() => (coverPicker = null)}
      onApplied={coverPickApplied}
    />
  {/if}

  {#if coverReport}
    <CoverReport
      albumKey={coverReport.key}
      label={coverReport.label}
      onClose={() => (coverReport = null)}
      onReported={(message: string) => (activityMessage = message)}
    />
  {/if}

  {#if aboutOpen}
    <div class="modal-backdrop" role="presentation" onclick={() => (aboutOpen = false)}>
      <dialog class="dialog" open aria-label={$t("About Deadwax")} onclick={(e) => e.stopPropagation()} onkeydown={(e) => { if (e.key === 'Escape') aboutOpen = false; }}>
        <header class="titlebar"><div class="title-left"><span class="app-icon"><img src="/deadwax-logo.png" alt="" /></span><span>{$t("About Deadwax")}</span></div><div class="window-controls"><button onclick={() => (aboutOpen = false)}>×</button></div></header>
        <div class="dialog-body about-dialog-body">
          <div class="about-summary"><div class="about-logo"><img src="/deadwax-logo-mark.png" alt="" /></div><div><h2>Deadwax</h2><p>{$t("Version")} {appVersion}</p><p>{$t("Public discovery over Nostr.")}<br />{$t("Private verified transfers over Tor.")}</p></div></div>
          <p class="about-donation">{$t("donations welcome!")}<br /><code>bc1qwgms685z3j69qtgalyjtrfuqg5f6pt302z0k60</code></p>
        </div>
        <div class="dialog-actions"><button class="classic-button primary" onclick={() => (aboutOpen = false)}>{$t("OK")}</button></div>
      </dialog>
    </div>
  {/if}

  {#if sourceProfile}
    <div class="modal-backdrop" role="presentation" onclick={() => (sourceProfile = null)}>
      <dialog class="dialog" open aria-label={$t("Deadwax public profile")} onclick={(e) => e.stopPropagation()}>
        <header class="titlebar"><div class="title-left"><span class="app-icon"><img src="/deadwax-logo.png" alt="" /></span><span>{$t("Public Deadwax Profile")}</span></div><div class="window-controls"><button onclick={() => (sourceProfile = null)}>×</button></div></header>
        <div class="dialog-body"><div class="about-logo">☺</div><div><h2><button class="user-name" onclick={() => browseUser(sourceProfile!)}>{sourceProfile.displayName}</button></h2><p>{sourceProfile.about || $t("No profile description published.")}</p><code>{sourceProfile.npub}</code></div></div>
        <div class="dialog-actions"><button class="classic-button primary" onclick={() => (sourceProfile = null)}>{$t("OK")}</button></div>
      </dialog>
    </div>
  {/if}

  {#if audiobookEditorOpen}
    <div class="modal-backdrop" role="presentation" onclick={() => { if (!audiobookSaving) audiobookEditorOpen = false; }}>
      <dialog class="dialog audiobook-dialog" open aria-label={$t("Group folder as audiobook")} onclick={(event) => event.stopPropagation()} onkeydown={(event) => { if (event.key === 'Escape' && !audiobookSaving) audiobookEditorOpen = false; }}>
        <header class="titlebar"><div class="title-left"><span class="app-icon">▥</span><span>{$t("Publish Audiobook")}</span></div><div class="window-controls"><button disabled={audiobookSaving} onclick={() => (audiobookEditorOpen = false)}>×</button></div></header>
        <div class="audiobook-dialog-body">
          <p>{$t("Deadwax will publish this folder as one ordered audiobook while retaining its normal chapter file events.")}</p>
          <label>{$t("Title")} <input bind:value={audiobookTitle} maxlength="256" /></label>
          <label>{$t("Author")} <input bind:value={audiobookAuthor} maxlength="256" /></label>
          <label>{$t("Narrator")} <input bind:value={audiobookNarrator} maxlength="256" /></label>
          <fieldset><legend>{$t("Chapter order")}</legend><div class="audiobook-preview">{#each audiobookChapters as file, index}<div><span>{String(index + 1).padStart(2, '0')}</span><b>{file.title || file.filename}</b><small>{file.readableSize}</small></div>{/each}</div></fieldset>
          <p class="privacy-note"><span>i</span> {$t("The title, author, narrator, chapter names, and ordered file hashes will be public. Your folder name and filesystem path remain private.")}</p>
        </div>
        <div class="dialog-actions audiobook-dialog-actions">{#if folderAudiobook}<button class="classic-button" disabled={audiobookSaving} onclick={ungroupAudiobook}>{$t("Publish separately")}</button>{/if}<span></span><button class="classic-button primary" disabled={audiobookSaving || !audiobookTitle.trim()} onclick={saveAudiobookGroup}>{audiobookSaving ? $t("Publishing…") : $t("Save & publish")}</button><button class="classic-button" disabled={audiobookSaving} onclick={() => (audiobookEditorOpen = false)}>{$t("Cancel")}</button></div>
      </dialog>
    </div>
  {/if}

  {#if blockConfirmation}
    <div class="modal-backdrop" role="presentation" onclick={() => { if (!blockInProgress) blockConfirmation = null; }}>
      <dialog class="dialog confirm-dialog" open aria-label={$t("Confirm block")} onclick={(e) => e.stopPropagation()} onkeydown={(e) => { if (e.key === 'Escape' && !blockInProgress) blockConfirmation = null; }}>
        <header class="titlebar"><div class="title-left"><span class="app-icon">!</span><span>{$t("Confirm block")}</span></div><div class="window-controls"><button disabled={blockInProgress} onclick={() => (blockConfirmation = null)}>×</button></div></header>
        <div class="dialog-body"><div class="confirm-icon">!</div><div><h3>{$t("Are you sure?")}</h3>{#if blockConfirmation.kind === 'file'}<p>{$t("Block")} <strong>{blockConfirmation.label}</strong>?</p><p>{$t("Every seeder offering these exact file bytes will be hidden.")}</p>{:else}<p>{$t("Block")} <strong>{blockConfirmation.label}</strong>?</p><p>{$t("Their catalogue entries, public chat messages, and download requests will be ignored.")}</p>{/if}</div></div>
        <div class="dialog-actions"><button class="classic-button primary" disabled={blockInProgress} onclick={confirmBlock}>{blockInProgress ? $t("Blocking…") : $t("Block")}</button><button class="classic-button" disabled={blockInProgress} onclick={() => (blockConfirmation = null)}>{$t("Cancel")}</button></div>
      </dialog>
    </div>
  {/if}
</main>
{/if}

