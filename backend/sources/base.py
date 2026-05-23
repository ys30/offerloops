"""Abstract base class for all job source connectors."""

from abc import ABC, abstractmethod
from typing import AsyncIterator
from ..models import Job


class BaseSource(ABC):
    id: str  # connector identifier, e.g. "usajobs"

    @abstractmethod
    async def fetch(self, **kwargs) -> AsyncIterator[Job]:
        """Yield normalized Job objects from this source."""
        ...
