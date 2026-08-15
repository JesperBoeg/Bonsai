from __future__ import annotations

from functools import lru_cache, wraps
import threading
from typing import Callable, TypeVar

DecoratedCallable = TypeVar("DecoratedCallable", bound=Callable)


def locked_lru_cache(maxsize: int | None = 1) -> Callable[[DecoratedCallable], DecoratedCallable]:
    """lru_cache variant whose calls are serialized with a threading.Lock.

    Guarantees the expensive first population runs exactly once even when
    multiple request threads hit a cold cache concurrently. After population,
    the lock only guards a cheap cache lookup.
    """

    def decorator(func):
        cached_func = lru_cache(maxsize=maxsize)(func)
        lock = threading.Lock()

        @wraps(func)
        def wrapper(*args, **kwargs):
            with lock:
                return cached_func(*args, **kwargs)

        wrapper.cache_info = cached_func.cache_info
        wrapper.cache_clear = cached_func.cache_clear
        return wrapper

    return decorator
