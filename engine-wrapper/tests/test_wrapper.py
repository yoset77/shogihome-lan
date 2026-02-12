import json

from engine_wrapper import get_engine_list


def test_get_engine_list_empty(tmp_path, monkeypatch):
    # BASE_DIR を tmp_path に向ける
    monkeypatch.setattr("engine_wrapper.BASE_DIR", tmp_path)

    # engines.json がない場合
    assert get_engine_list() == []


def test_get_engine_list_valid(tmp_path, monkeypatch):
    monkeypatch.setattr("engine_wrapper.BASE_DIR", tmp_path)

    engines_data = [{"id": "test-engine", "name": "Test Engine", "path": "path/to/engine"}]
    engines_json = tmp_path / "engines.json"
    engines_json.write_text(json.dumps(engines_data), encoding="utf-8")

    result = get_engine_list()
    assert len(result) == 1
    assert result[0]["id"] == "test-engine"


def test_get_engine_list_invalid_json(tmp_path, monkeypatch):
    monkeypatch.setattr("engine_wrapper.BASE_DIR", tmp_path)

    engines_json = tmp_path / "engines.json"
    engines_json.write_text("invalid json", encoding="utf-8")

    # エラー時は空配列を返すはず
    assert get_engine_list() == []
