"use client";

import { useDeferredValue, useId, useState } from "react";
import type { CatalogEntry } from "../lib/bonsai";

type SpeciesSearchPickerProps = {
  defaultSpeciesId: string;
  inputName: string;
  speciesCatalog: CatalogEntry[];
  selectedSpeciesId?: string;
  onSelectedSpeciesIdChange?: (speciesId: string) => void;
};

type SearchResult = {
  entry: CatalogEntry;
  score: number;
};

export function SpeciesSearchPicker({
  defaultSpeciesId,
  inputName,
  speciesCatalog,
  selectedSpeciesId,
  onSelectedSpeciesIdChange,
}: SpeciesSearchPickerProps) {
  const initialSelectedEntry = speciesCatalog.find((entry) => String(entry.id) === defaultSpeciesId) ?? null;
  const [query, setQuery] = useState("");
  const [internalSelectedEntry, setInternalSelectedEntry] = useState<CatalogEntry | null>(initialSelectedEntry);
  const [highlightedResultIndex, setHighlightedResultIndex] = useState(0);
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = normalizeSearchValue(deferredQuery);
  const inputId = useId();
  const searchHintId = useId();
  const resultsId = useId();
  const resultOptionIdPrefix = useId();
  const results = normalizedQuery.length > 0 ? rankSpeciesMatches(normalizedQuery, speciesCatalog) : [];
  const normalizedHighlightedResultIndex = results.length > 0 ? Math.min(highlightedResultIndex, results.length - 1) : 0;
  const activeResult = results[normalizedHighlightedResultIndex] ?? null;
  const isResultsOpen = normalizedQuery.length > 0 && results.length > 0;

  const isControlled = typeof selectedSpeciesId === "string" && typeof onSelectedSpeciesIdChange === "function";
  const selectedEntry = isControlled
    ? (speciesCatalog.find((entry) => String(entry.id) === selectedSpeciesId) ?? null)
    : internalSelectedEntry;

  function updateSelectedEntry(entry: CatalogEntry | null) {
    if (isControlled) {
      onSelectedSpeciesIdChange(entry ? String(entry.id) : "");
      return;
    }

    setInternalSelectedEntry(entry);
  }

  function selectEntry(entry: CatalogEntry) {
    updateSelectedEntry(entry);
    setQuery("");
    setHighlightedResultIndex(0);
  }

  return (
    <label className="field-block species-search-picker">
      <span>Species</span>
      <select
        aria-hidden="true"
        className="species-search-select-proxy"
        name={inputName}
        onChange={(event) => {
          const nextSelection = speciesCatalog.find((entry) => String(entry.id) === event.target.value) ?? null;
          updateSelectedEntry(nextSelection);
        }}
        required
        tabIndex={-1}
        value={selectedEntry ? String(selectedEntry.id) : ""}
      >
        <option value="">Choose a species</option>
        {speciesCatalog.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {formatCatalogDisplayLabel(entry.label, entry.subtitle)}
          </option>
        ))}
      </select>
      <div className="species-search-toolbar">
        <input
          aria-activedescendant={activeResult ? `${resultOptionIdPrefix}-${activeResult.entry.id}` : undefined}
          aria-autocomplete="list"
          aria-controls={isResultsOpen ? resultsId : undefined}
          aria-describedby={searchHintId}
          aria-expanded={isResultsOpen}
          autoComplete="off"
          id={inputId}
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlightedResultIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              if (query.length > 0) {
                event.preventDefault();
                setQuery("");
                setHighlightedResultIndex(0);
              }

              return;
            }

            if (results.length === 0) {
              return;
            }

            if (event.key === "ArrowDown") {
              event.preventDefault();
              setHighlightedResultIndex((currentIndex) => (currentIndex + 1) % results.length);
              return;
            }

            if (event.key === "ArrowUp") {
              event.preventDefault();
              setHighlightedResultIndex((currentIndex) => (currentIndex - 1 + results.length) % results.length);
              return;
            }

            if (event.key === "Home") {
              event.preventDefault();
              setHighlightedResultIndex(0);
              return;
            }

            if (event.key === "End") {
              event.preventDefault();
              setHighlightedResultIndex(results.length - 1);
              return;
            }

            if (event.key === "Enter" && activeResult) {
              event.preventDefault();
              selectEntry(activeResult.entry);
            }
          }}
          placeholder="Search by common or botanical name"
          role="combobox"
          type="text"
          value={query}
        />
        {selectedEntry ? (
          <button
            className="button button-ghost"
            onClick={() => {
              updateSelectedEntry(null);
              setQuery("");
            }}
            type="button"
          >
            Clear
          </button>
        ) : null}
      </div>
      <p className="helper-text" id={searchHintId}>
        Search by common or botanical name, then choose the species that fits this tree.
      </p>
      <div className="species-search-selected">
        <span>Current choice</span>
        <strong>{selectedEntry ? formatCatalogDisplayLabel(selectedEntry.label, selectedEntry.subtitle) : "No species chosen yet."}</strong>
      </div>
      {normalizedQuery.length > 0 ? (
        results.length > 0 ? (
          <ul aria-labelledby={inputId} className="species-search-results" id={resultsId} role="listbox">
            {results.map(({ entry }, index) => (
              <li key={entry.id} role="none">
                <button
                  aria-selected={index === normalizedHighlightedResultIndex}
                  className={`species-search-result${index === normalizedHighlightedResultIndex ? " is-active" : ""}${selectedEntry?.id === entry.id ? " is-selected" : ""}`}
                  id={`${resultOptionIdPrefix}-${entry.id}`}
                  onClick={() => {
                    selectEntry(entry);
                  }}
                  onMouseEnter={() => {
                    setHighlightedResultIndex(index);
                  }}
                  role="option"
                  tabIndex={-1}
                  type="button"
                >
                  <strong>{entry.label}</strong>
                  <span>{entry.subtitle ?? entry.aliases?.[0] ?? entry.slug}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="helper-text">No close match yet. Try another common or botanical name.</p>
        )
      ) : (
        <p className="helper-text">{selectedEntry ? "Start typing to choose a different species." : "Start typing to look for the species."}</p>
      )}
      {normalizedQuery.length > 0 && (!selectedEntry || !entryMatchesQuery(selectedEntry, normalizedQuery)) ? (
        <p className="helper-text">Choose one of the results above to set the species.</p>
      ) : null}
    </label>
  );
}

function rankSpeciesMatches(query: string, speciesCatalog: CatalogEntry[]) {
  return speciesCatalog
    .map((entry) => ({
      entry,
      score: readEntrySearchScore(query, entry),
    }))
    .filter((result): result is SearchResult => result.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.entry.label.localeCompare(right.entry.label);
    })
    .slice(0, 12);
}

function readEntrySearchScore(query: string, entry: CatalogEntry) {
  let bestScore = 0;

  for (const candidate of buildSearchCandidates(entry)) {
    bestScore = Math.max(bestScore, readCandidateSearchScore(query, candidate));
  }

  return bestScore;
}

function readCandidateSearchScore(query: string, candidate: string) {
  if (candidate === query) {
    return 1000;
  }

  if (candidate.startsWith(query)) {
    return 900 - Math.max(0, candidate.length - query.length);
  }

  const queryIndex = candidate.indexOf(query);
  if (queryIndex >= 0) {
    return 760 - queryIndex;
  }

  const queryTokens = query.split(" ").filter((token) => token.length > 0);
  const candidateWords = candidate.split(" ").filter((token) => token.length > 0);
  let matchedTokens = 0;
  let tokenScore = 0;

  for (const token of queryTokens) {
    let bestTokenScore = 0;

    for (const word of candidateWords) {
      if (word.startsWith(token)) {
        bestTokenScore = Math.max(bestTokenScore, 180 - Math.abs(word.length - token.length));
        continue;
      }

      if (word.includes(token)) {
        bestTokenScore = Math.max(bestTokenScore, 130);
      }

      const distance = readLevenshteinDistance(token, word);
      const maxDistance = token.length <= 4 ? 1 : 2;

      if (distance <= maxDistance) {
        bestTokenScore = Math.max(bestTokenScore, 120 - distance * 25);
      }
    }

    if (bestTokenScore > 0) {
      matchedTokens += 1;
      tokenScore += bestTokenScore;
    }
  }

  if (matchedTokens === queryTokens.length && queryTokens.length > 0) {
    return 500 + tokenScore;
  }

  const fullDistance = readLevenshteinDistance(query, candidate);
  const maxFullDistance = query.length <= 5 ? 1 : 2;

  if (fullDistance <= maxFullDistance) {
    return 320 - fullDistance * 40;
  }

  return 0;
}

function readLevenshteinDistance(left: string, right: string) {
  if (left === right) {
    return 0;
  }

  if (left.length === 0) {
    return right.length;
  }

  if (right.length === 0) {
    return left.length;
  }

  const previousRow = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    let previousDiagonal = previousRow[0];
    previousRow[0] = leftIndex + 1;

    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const nextDiagonal = previousRow[rightIndex + 1];
      const substitutionCost = left[leftIndex] === right[rightIndex] ? 0 : 1;
      previousRow[rightIndex + 1] = Math.min(
        previousRow[rightIndex + 1] + 1,
        previousRow[rightIndex] + 1,
        previousDiagonal + substitutionCost,
      );
      previousDiagonal = nextDiagonal;
    }
  }

  return previousRow[right.length];
}

function buildSearchCandidates(entry: CatalogEntry) {
  return [...new Set([entry.label, entry.subtitle ?? "", ...(entry.aliases ?? [])]
    .map((value) => normalizeSearchValue(value))
    .filter((value) => value.length > 0))];
}

function entryMatchesQuery(entry: CatalogEntry, query: string) {
  return buildSearchCandidates(entry).some((candidate) => candidate.includes(query));
}

function normalizeSearchValue(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function formatCatalogDisplayLabel(label: string, subtitle: string | null) {
  return subtitle ? `${label} (${subtitle})` : label;
}