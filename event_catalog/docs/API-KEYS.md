# API keys for activity collection

The crawler currently accepts two API keys: DATAtourisme and OpenAgenda.
They retrieve activity data, including dates, locations and basic descriptions
when the publisher supplies those fields. They are not website login credentials.
Reading the shared SQLite database, CSV files or published viewer needs no key.

## The two keys

| Platform | Purpose in this project | Local variable | Where to obtain a key |
|---|---|---|---|
| DATAtourisme | Collect tourism events and places of interest, filtered for Occitanie. | `DATATOURISME_API_KEY` | Request a free production key using the [official registration page](https://www.datatourisme.fr/utiliser-les-donnees/). |
| OpenAgenda | Discover public calendars and collect published events from selected calendars. | `OPENAGENDA_PUBLIC_KEY` | Create an OpenAgenda account, then generate a public key in [API settings](https://openagenda.com/settings/apiKey). |

DATAtourisme requests use the `X-API-Key` header on
`https://api.datatourisme.fr/v1`. The relevant endpoints are
`/entertainmentAndEvent` and `/placeOfInterest`. The documented provider limits
are 1,000 requests/hour, about 10 requests/second sustained, and 20–30 concurrent
requests per client. These are provider ceilings, not recommended crawler
settings. See the [official API documentation](https://api.datatourisme.fr/v1/docs).

OpenAgenda requests use the `key` header on `https://api.openagenda.com/v2`.
Use an **`oa_pk_` public key**, which reads public, published data. The crawler
rejects account-secret `oa_sk_` keys and legacy keys without the public prefix.
OpenAgenda distinguishes public keys from account-secret keys; the latter can
carry additional account permissions. See [authentication](https://developers.openagenda.com/authentification/)
and the [API overview](https://developers.openagenda.com/), which describes free
API access. No universal numeric OpenAgenda quota is assumed here.

Provider documentation checked on 2026-10-10. Recheck terms and limits before
increasing collection volume.

## Configure locally

From the repository root, create the private file without overwriting an
existing configuration:

```sh
cd event_catalog
cp -n .env.example .env
chmod 600 .env
```

Open `.env` in a local editor and fill these two values with your own keys:

```dotenv
DATATOURISME_API_KEY=
OPENAGENDA_PUBLIC_KEY=
```

Keep actual values out of commits, CSV exports, screenshots and URLs. This
public repository contains only variable names and an empty template. Although
OpenAgenda classifies `oa_pk_` as public, the project's configured value is also
kept outside Git. `.env` is ignored by Git.

The `sync`, `doctor` and local `serve` commands load the project `.env` file.
Existing process environment variables take precedence. The file accepts
literal `NAME=value` entries for these two names; do not add shell commands.

For a fresh operational database, run:

```sh
python3 -m sncf_events init
python3 -m sncf_events doctor
```

`doctor` reports key presence and basic format without displaying values or
making network requests. A `configured` result does not prove that the provider
currently accepts the key. Use a bounded sync after reviewing and enabling the
source and endpoint, as described in [collection and maintenance](OPERATIONS.md).

## Coverage

A key does not enable every source automatically or grant data reuse rights.
OpenAgenda still needs calendar discovery and selected calendar IDs.
[sources.csv](../distribution/csv/sources.csv) contains 144 research entries;
it is not a list of 144 working crawlers. Four sources have been collected in
the shared snapshot.

The current Région Occitanie and Musée Fabre collectors, IGN walking-route
requests and local station CSV import do not require either key. No SNCF API
key is used by these collectors. Other platforms in the source registry may
need separate access agreements or future connectors.
