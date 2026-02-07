from common import get_pc_url_config


def test_get_pc_url_config_default_mode():
    # 0.0.0.0 (All interfaces)
    url, allowed = get_pc_url_config("0.0.0.0", 8140, False, [], "192.168.1.10")
    assert url == "http://127.0.0.1:8140"
    assert allowed is True

    # 127.0.0.1 (Localhost only)
    url, allowed = get_pc_url_config("127.0.0.1", 8140, False, [], "192.168.1.10")
    assert url == "http://127.0.0.1:8140"
    assert allowed is True

    # Specific IP
    url, allowed = get_pc_url_config("192.168.1.10", 8140, False, [], "192.168.1.10")
    assert url == "http://192.168.1.10:8140"
    assert allowed is True


def test_get_pc_url_config_strict_mode_allowed():
    # Strict mode, but localhost is allowed
    url, allowed = get_pc_url_config("0.0.0.0", 8140, True, ["http://127.0.0.1:8140"], "192.168.1.10")
    assert url == "http://127.0.0.1:8140"
    assert allowed is True

    # Strict mode, LAN IP is allowed
    url, allowed = get_pc_url_config("0.0.0.0", 8140, True, ["http://192.168.1.10:8140"], "192.168.1.10")
    assert url == "http://192.168.1.10:8140"
    assert allowed is True

    # Strict mode, multiple allowed, pick first matching local endpoint
    allowed_origins = ["http://localhost:8140", "http://127.0.0.1:8140"]
    url, allowed = get_pc_url_config("0.0.0.0", 8140, True, allowed_origins, "192.168.1.10")
    assert url == "http://127.0.0.1:8140"  # 127.0.0.1 is first in local_endpoints
    assert allowed is True


def test_get_pc_url_config_strict_mode_not_locally_allowed():
    # Strict mode, only proxy domain allowed
    url, allowed = get_pc_url_config("0.0.0.0", 8140, True, ["https://shogi.example.com"], "192.168.1.10")
    assert url == "https://shogi.example.com"
    assert allowed is True


def test_get_pc_url_config_strict_mode_blocked():
    # Strict mode, no origins defined
    url, allowed = get_pc_url_config("0.0.0.0", 8140, True, [], "192.168.1.10")
    assert allowed is False
    assert url == "http://127.0.0.1:8140"


def test_get_pc_url_config_trailing_slash_normalization():
    # Test that it handles trailing slashes in ALLOWED_ORIGINS correctly
    allowed_origins = ["http://127.0.0.1:8140/"]
    url, allowed = get_pc_url_config("0.0.0.0", 8140, True, allowed_origins, "192.168.1.10")
    assert url == "http://127.0.0.1:8140"
    assert allowed is True
