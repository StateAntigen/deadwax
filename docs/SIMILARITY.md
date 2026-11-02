# Finding similar music from metadata alone

How a Deadwax client can answer "more like this" without a new event kind, a new
field, an analysis library, or anybody else changing anything.

Nothing in this document needs a protocol change. Every signal below is already
published, already signed, and already in a table on this computer or on the phone
it is paired with. The only things that do not exist yet are the queries that put
them together, and they are written out in the appendix.

Status of the pieces it leans on:

| Piece | Where it lives | Ready? |
|---|---|---|
| Catalogue mirror, one row per announcement | `remote_catalogue` | yes |
| Who is holding a file right now | `catalogue_seeder`, kind `30422` | yes |
| Playlists, members stored one row each | `playlists`, `playlist_tracks` | yes |
| "Which playlists name this file" | `playlist::containing`, `idx_playlist_tracks_file` | yes |
| Somebody else's playlist, filed on read | `playlist::store_from_relay` | yes |
| Album genre, year, MusicBrainz id | kind `30427`, `album_covers` | yes, where claimed |
| A fair draw of the live network | `catalogue::discover` | yes, as of this change |
| A station built from these signals | nowhere | **to build** |

---

## 1. What the network already says

Kind `30421` — one per file per author — carries exactly this, and no more:

```
fileId  filename  title  artist  album  format  mime  size  license  description  tags
```

On top of the body, the event carries `t` tags: at most **20 distinct words**, at
most 32 characters each, derived from the filename, title, artist and album, plus
whatever the author put in `tags`. That derivation is
`network::catalogue_search_tokens`, and it is the only place a file's own words
become something a relay can be asked about.

Kind `30427` carries, per **album** rather than per file: `genre`, `year`,
`collection`, `mbid`. It is self-asserted and explicitly not a trust signal — a
claim is somebody's opinion, published. It is also already arriving: both clients
receive `genre` on every album cover, and neither draws it.

Kind `30425` carries a playlist: a title, the author's own `tags`, an optional
album `artist`/`mbid`, and an ordered list of file ids. Members are stored one row
each, so "which playlists name this file" is an index lookup rather than a scan.

And locally: `files` (what this computer holds), `published_catalogue` (what it has
said so far), and the phone's own liked list.

## 2. What it does not say, and what that costs

- **No genre on a track.** A genre word reaches the network only if the author typed
  it into `tags`. The index does not read the file's own `TCON`/`GENRE` frame
  either, so even a perfectly tagged local library is invisible to genre search.
- **No year, label, BPM or duration on a track.** `RemoteTrack.durationMs` is `0`
  for every catalogue row — a catalogue entry says what a file is called and how big
  it is, never what the audio in it is. A year exists only on a `30427` claim, where
  it belongs to the album rather than to the file (§3.4).
- **No fingerprint.** A file id is a SHA-256 of the bytes, so it identifies *this
  encoding of this file* and nothing else. Two rips of the same record are two
  unrelated ids, and no amount of metadata joins them.
- **`seen_at` is not a network fact.** `remote_catalogue.seen_at` is written as
  `Utc::now()` when this computer mirrors the row. It says when this disk learned
  something, not when anybody said it. It has already caused one visible bug (see
  §8) and it must not be used as a proxy for freshness, popularity or recency.

So the honest position is: we can describe *what a file is called and who made it*,
and we can describe *what people put next to what*. That is narrower than an
embedding, and it is enough to build a station on a network this size.

## 3. The signals, in order of density

### 3.1 Playlist co-occurrence — the best signal, the thinnest inventory

Two files that the same person put in the same playlist are related by a human
decision. That is worth more than any pair of words, and it is cheap: one indexed
lookup per seed.

Weight each playlist by how much it says. A playlist of 500 files asserts very
little about any two of them; a playlist of 12 asserts a lot:

```
co(c) = Σ over playlists p where seed ∈ p and c ∈ p of  1 / (2 + |p|)
```

Then squash so a file in ten playlists is not ten times better than one in two:
`co_hat = co / (1 + co)`.

(A logarithm would sharpen this into the familiar "inverse document frequency"
curve. The plain reciprocal is used because SQLite's math functions are only
compiled in on some builds, and the shape — every extra member makes the pair mean
slightly less — is the part that matters.)

The inventory is thin today — one curator — but the important property is that
**this signal grows without any new code**. `store_from_relay` already files other
authors' public playlists locally, and `containing` already answers the reverse
question. The day a second person publishes a playlist, every station on this
computer gets a new signal, with nothing shipped.

### 3.2 Album and artist adjacency — free, and always available

Same artist and same album is the strongest relation the catalogue can express, and
it is exactly the one a listener means by "more like this":

- same album (`lower(artist)`, `lower(album)` both equal, different file id) → 1.00
- same artist, different album → 0.55

This is the signal that works on a network with no playlists at all, and the one
that makes a station coherent on the very first tap.

### 3.3 Shared words — where genre would have been

The `t` tokens are the words that already make search work, so reusing them is free:
`remote_catalogue_fts` is already populated, maintained by triggers, and repaired
when it is damaged.

In practice this signal is about the title, the artist and the album. The author's
own `tags` field — the only place a hand-written genre word can live today — is
filled in for **481 of 76,805 announcements** on this installation, so a word there
is a rare exception rather than a source of neighbour.

Score overlap with inverse document frequency, so `the` and `live` count for
nothing and `shoegaze` counts for a lot:

```
words(c) = Σ over shared terms w of idf(w)  /  Σ over terms of the seed of idf(w)
```

`idf` is a count away, and the index already answers it: a `MATCH` for one word
gives the number of announcements containing it, and `remote_catalogue_fts_docsize`
gives the document lengths the same weighting needs. Drop the stop words the
catalogue already drops — and drop the artist's and album's own tokens, because
those are already scored above and counting them twice turns one signal into three.

### 3.4 Genre and era, where a claim exists

`album_covers.genre` and `album_covers.year` come from `30427` claims, so they exist
only for albums somebody chose to describe — on this network, mostly the albums the
local cover worker has touched. Treat them as a small bonus and never as a gate:

- same normalised genre → +0.12
- same decade from `year` → +0.04

Measured here: 1,259 albums have a live claim, **421** of them carry a genre and
**1,255** a year. Twenty-two percent of the network's live files sit in an album with
a genre, against ninety-one percent of this computer's own albums having a year. So
genre is a bonus and never a filter — 78% of the network would be excluded by one —
and era is the better-covered axis but only worth a tie-break, because a shared
decade is a weak claim about two files.

Genre strings are messy, and the mess is already visible in this data: twenty-two
distinct values that include both `hip hop` and `hip-hop`. Normalise to lowercase and
collapse whitespace, keep a tiny alias map for the handful of spellings that always
appear, and do not attempt ontology work — the data does not support it and the
reward is a rounding error in the score.

### 3.5 Freshness — not similarity, but what an empty install has

An install with no library, no likes and no playlists cannot ask "more like this",
because it has no seed. What it can do is look at what the network is sharing, and
that is a different axis: not "related" but "new".

`discover` is that axis and is described in §8. It is deliberately *not* mixed into
the similarity score — mixing the two makes a station drift towards whatever was
published most recently instead of whatever the seed is like.

## 4. Scoring one candidate

For a seed `s`, each candidate `c` gets:

```
score(c) = 1.00 · album(c)
         + 0.55 · artist(c)
         + 0.90 · co_hat(c)
         + 0.35 · words(c)
         + 0.12 · genre(c)
         + 0.04 · decade(c)
```

Why those numbers: album beats everything because it is nearly always right. Artist
carries about half of album, because "same artist" is weaker than "same record" but
still stronger than curation. Co-occurrence outranks words because a person putting
two files together is evidence and word overlap is a guess. Genre is a hint — its
coverage is partial and its values are self-asserted — so it never outweighs a
shared playlist.

The weights are a starting point, not a law. They are all in one place so they can
be one function with one test, the way `throttle_delay` is.

## 5. Assembling a station

```
seed s
  ↓
candidates ← union of
    members of playlists containing s           (indexed)
    files by s.artist, s.album                  (scan of remote_catalogue; 76k rows, ms)
    files whose t tokens overlap s's strongly   (FTS, reused)
    files in albums with the same genre         (album_covers)
  ↓
filter: live availability (30422), not blocked, not already in the queue
  ↓
score every candidate
  ↓
drop everything below 0.30 — a station that pads itself with noise
   sounds like a station that does not know what it is
  ↓
maximal marginal relevance, λ = 0.7:
   each next pick maximises  λ·score(c) − (1−λ)·(already chosen by same album or artist)
  ↓
cap at DISCOVER_PER_ARTIST per artist, as the discover list does
  ↓
page it 30 rows at a time
```

The MMR step is what stops a station from becoming "the rest of this album and then
four more by the same band": the first pick is always the best score, the second has
to be good *and* not the same record.

Availability is a filter and not a weight. A station that queues files nobody is
holding does not play, and the phone already has machinery for exactly this: a
queued file nobody holds is fetched while it is still songs away.

## 6. Cold start: the first five minutes of a new install

This is the case that decides whether any of the above matters, and it is where the
"no new kind" constraint bites hardest. A fresh install has no library, no likes,
no playlists, and nothing to seed from.

What it does have:

1. **A fair draw of the live network.** `discover` gives a seeded sample of every
   file somebody is holding, capped per artist, so the first screen is a varied
   handful rather than one backfill's tail.
2. **The ability to seed from what it cannot play yet.** Tapping a network row
   starts a station from *that file's* metadata, which the catalogue has whether or
   not this computer holds the bytes. Discovery is tap-to-start, not
   similarity-to-my-library. That single decision is what makes an empty install
   work at all.
3. **Everybody as a friend.** With a small network, "new from everybody" is the
   first screen; it is the same query as `discover`, ordered by first share rather
   than sampled.

One local column is worth adding for this, and it is not a protocol change:
**`first_seen`** beside the existing `seen_at` in `remote_catalogue`, written once
per `(file_id, source_pubkey)` and never updated. A 30421 is addressable, so a host
that republishes its catalogue — new schema, new tags, a reindex — makes its whole
library look new if "new" is decided by anything that moves. `first_seen` does not
move. It is also what makes "new from alice: 412 tracks" a stable statement rather
than a statement that flickers every time alice's computer restarts.

## 7. What this cannot do

Worth writing down, so nobody is surprised later:

- **It cannot tell that two files are the same recording.** A file id is a hash of
  the bytes. An MP3 and a FLAC of the same track are two unrelated files with the
  same title, and the catalogue has no fingerprint to join them. Deduplicating
  across formats is a separate problem.
- **It cannot say what a file sounds like.** No genre reading, no descriptors, so
  "more like this" means "more like what this is called, who made it, and who put it
  next to what".
- **It is as good as the metadata.** A library with `Track 01` in the title and an
  empty artist scores nothing. That is honest rather than broken: it is what the
  network actually says about those files.
- **Discussion is not a relation.** Kind 9 gives one topic per file, so it can say
  "people are talking about this" but not "these two go together". Useful as a mark
  on a row; not a similarity edge.

## 8. The one bug this analysis already found

`discover` used to be:

```sql
ORDER BY seeders DESC, newest DESC
LIMIT 500
```

with `newest` being `MAX(seen_at)` — this computer's own write time. On a real
installation, 500 of 500 candidates had exactly one seeder, so the first key sorted
nothing and write order decided the entire window; 415 of those 500 rows were one
artist, and `MostSeeded` and `LeastSeeded` returned the same files because `ASC` and
`DESC` agree when every value is 1. The shuffle ran *after* the window, so no seed
could escape it.

What it is now: every live file ordered by `shuffle_key(seed, file_id)` — the same
key the phone's shuffled browse uses — capped at 6 rows per artist and 160 per
author, then cut to the window and ordered by seeder count. Measured on that same
installation:

| | before | after |
|---|---|---|
| rows in the window | 500 | 480 |
| distinct artists | 16 | **154** |
| largest single artist | 415 | 6 |
| files shared by two different seeds | 500 / 500 | **61 / 480** |

The lesson generalises to every query in this document: **anything ordered by
`seen_at` is ordered by this computer's own activity**. Use it to answer "what did
this disk learn last", and for nothing else.

## 9. If you ever allow one more thing

The cheapest change that would materially improve all of the above is not a new
kind — it is reading the genre frame the file already carries (`TCON`, `GENRE`) into
the derived `t` tokens. It costs one field in the index, it makes genre searchable
network-wide through `#t` with no protocol change, and it feeds §3.4 with real values
instead of claims.

Do not write it into `content.tags`. That field is the author's own choice, and the
playlist NIP already states the rule for suggested words: a client may suggest, and
must never put its own words in the author's mouth.

A self-computed audio descriptor is the later, more expensive step — a fingerprint
for cross-format identity and a vector for actual sound. It is worth doing only
after the four signals above have been tried, because at 3,200 tracks the metadata
signals are already dense enough to build a station, and the descriptor is the part
that costs a licence decision.

## Appendix A: queries

Members of playlists that name a seed, weighted by how much the playlist says:

```sql
SELECT t.file_id,
       SUM(1.0 / (2 + (SELECT COUNT(*) FROM playlist_tracks n
                        WHERE n.playlist_id = t.playlist_id
                          AND n.author = t.author))) AS weight
  FROM playlist_tracks t
  JOIN (SELECT DISTINCT author, playlist_id FROM playlist_tracks WHERE file_id = ?1) p
    USING (author, playlist_id)
 WHERE t.file_id <> ?1
 GROUP BY t.file_id
 ORDER BY weight DESC
 LIMIT 500;
```

The same album, from the catalogue this computer already mirrors:

```sql
SELECT file_id, title, artist, album
  FROM remote_catalogue
 WHERE lower(album) = lower(?1) AND lower(artist) = lower(?2)
   AND file_id <> ?3
 GROUP BY file_id;
```

The same artist, a different album:

```sql
SELECT file_id, title, album
  FROM remote_catalogue
 WHERE lower(artist) = lower(?1) AND lower(album) <> lower(?2)
   AND file_id <> ?3
 GROUP BY file_id;
```

Which albums have a genre to join on. The key is `artist|album`, exactly as
`cover::cover_key` builds it, so a seed's own key finds its neighbours'. There is one
row per claim, so several may answer for one album and the app's `best_known_covers`
is what decides between them:

```sql
SELECT DISTINCT cover_key, genre, year
  FROM album_covers
 WHERE trim(genre) <> '' AND deleted = 0
 ORDER BY cover_key;
```

Words a seed would be joined by, through the index that already exists. `?1` is a
plain word — FTS5's column form, `tags : "shoegaze"`, parses and works, but that
column is empty for 99.4% of the network, so the useful words are the ones derived
from title, artist and album:

```sql
SELECT c.file_id, c.title, c.artist
  FROM remote_catalogue_fts
  JOIN remote_catalogue c ON c.rowid = remote_catalogue_fts.rowid
 WHERE remote_catalogue_fts MATCH ?1      -- e.g. "shoegaze"
 LIMIT 200;
```

Live availability, as every one of the above must be filtered by:

```sql
SELECT file_id FROM catalogue_seeder WHERE expires_at > ?1;
```

## Appendix B: this installation, measured

Read from `napstr.sqlite3` in the app-data folder (`%APPDATA%\social.deadwax.desktop`
on Windows), read-only, while the app was running:

| | |
|---|---|
| announcements in the mirror | 76,805 |
| distinct files | 73,440 |
| files with a live heartbeat | 20,730 |
| live, not owned here, not blocked | 15,972 |
| authors of those files | 4 |
| files held by the largest author | 8,062 |
| files this computer holds | 3,189 |
| announcements with any author `tags` | 481 (0.6%) |
| albums with a live `30427` claim | 1,259 |
| …carrying a genre / a year | 421 / 1,255 |
| live files in an album with a genre | 3,470 (22%) |
| local albums with a genre / a year | 103 / 431 of 476 |
| playlists filed here | 7, holding 207 members |

Four publishers is the whole network. That number is the design constraint for
everything in this document: a station built only from playlist co-occurrence would
be nearly empty, which is why album/artist adjacency carries the first version and
why "new from everybody" is a first-class page rather than a fallback.

The other number to keep in view is 22%. Any design that gates on genre — "more from
this genre" — is throwing away four fifths of the network before it starts. Genre is
what makes a list *better* when it is there; it can never be what makes a list.
