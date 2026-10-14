"""
ingest/providers/__init__.py
────────────────────────────
Provider registry + factory.

    from ingest.providers import make_provider, make_probability_sources

Adding a source is two lines here and one subclass elsewhere; nothing in
pipeline/, sinks/ or the Brain changes.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from ingest.providers.base import (
    DataProvider,
    NotSupported,
    ProbabilitySource,
    ProviderError,
)
from ingest.providers.fixture import FixtureProvider
from ingest.providers.model import ModelProbabilitySource, PoissonRatings
from ingest.providers.odds import OddsApiProbabilitySource

PROVIDERS: Dict[str, str] = {
    "fixture": "ingest.providers.fixture:FixtureProvider",
    "api_sports": "ingest.providers.api_sports:ApiSportsProvider",
}

PROBABILITY_SOURCES: Dict[str, str] = {
    "odds": "ingest.providers.odds:OddsApiProbabilitySource",
    "model": "ingest.providers.model:ModelProbabilitySource",
}

__all__ = [
    "DataProvider",
    "ProbabilitySource",
    "ProviderError",
    "NotSupported",
    "FixtureProvider",
    "ModelProbabilitySource",
    "OddsApiProbabilitySource",
    "PoissonRatings",
    "make_provider",
    "make_probability_sources",
]


def _import(dotted: str) -> Any:
    module_name, _, attr = dotted.partition(":")
    module = __import__(module_name, fromlist=[attr])
    return getattr(module, attr)


def make_provider(name: str, **kwargs: Any) -> DataProvider:
    """
    Instantiate a provider by name.

        python -m ingest.cli run --provider api_sports
        python -m ingest.cli run --provider fixture --fixtures examples/provider_fixtures
    """
    if name not in PROVIDERS:
        raise ProviderError(
            f"unknown provider '{name}' — available: {', '.join(sorted(PROVIDERS))}"
        )
    cls = _import(PROVIDERS[name])
    return cls(**kwargs)


def make_probability_sources(
    names: List[str],
    provider: DataProvider,
    resolver: Any = None,
    **kwargs: Any,
) -> List[ProbabilitySource]:
    """
    Build the probability chain, in priority order.

    The first source that can price a fixture wins (each source skips fixtures
    that already carry a probability), so a typical order is:

        ["odds", "model"]   — market first, model as backfill

    A source that fails to initialise (missing key) is dropped with a warning
    rather than aborting the run.
    """
    sources: List[ProbabilitySource] = []
    for name in names:
        if name not in PROBABILITY_SOURCES:
            raise ProviderError(
                f"unknown probability source '{name}' — available: "
                f"{', '.join(sorted(PROBABILITY_SOURCES))}"
            )
        cls = _import(PROBABILITY_SOURCES[name])
        try:
            if name == "model":
                sources.append(cls(provider=provider, resolver=resolver, **kwargs))
            else:
                sources.append(cls(resolver=resolver, **kwargs))
        except ProviderError as exc:
            import logging
            logging.getLogger("ingest").warning("probability source '%s' disabled: %s", name, exc)
    return sources
