import pytest

from app.models import RecoveryContract
from app.simulation.state import SimulationState


@pytest.fixture
def sim():
    return SimulationState()


@pytest.fixture
def contract():
    return RecoveryContract()

