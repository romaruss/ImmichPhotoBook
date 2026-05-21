"""
config_loader.py — Deep configuration system.
Loads deep_config_defaults.json, overlays /data/deep_config.json user overrides.
Call cfg('section', 'key') anywhere in backend code.
Call reload() after saving user overrides to hot-apply changes.
"""
import json
import copy
import pathlib

_DEFAULTS_FILE = pathlib.Path(__file__).parent / 'deep_config_defaults.json'
_USER_FILE = pathlib.Path('/data/deep_config.json')

_config: dict | None = None


def _deep_merge(base: dict, override: dict) -> dict:
    result = copy.deepcopy(base)
    for k, v in override.items():
        if k in result and isinstance(result[k], dict) and isinstance(v, dict):
            result[k] = _deep_merge(result[k], v)
        else:
            result[k] = v
    return result


def reload() -> dict:
    global _config
    defaults = json.loads(_DEFAULTS_FILE.read_text())
    if _USER_FILE.exists():
        try:
            user = json.loads(_USER_FILE.read_text())
            _config = _deep_merge(defaults, user)
        except Exception:
            _config = copy.deepcopy(defaults)
    else:
        _config = copy.deepcopy(defaults)
    return _config


def cfg(section: str, key: str):
    if _config is None:
        reload()
    return _config[section][key]


def get_all() -> dict:
    if _config is None:
        reload()
    return copy.deepcopy(_config)


def get_defaults() -> dict:
    return json.loads(_DEFAULTS_FILE.read_text())


def _compute_delta(defaults: dict, current: dict) -> dict:
    delta = {}
    for section, vals in current.items():
        if not isinstance(vals, dict):
            continue
        section_delta = {}
        for k, v in vals.items():
            if section in defaults and k in defaults[section] and defaults[section][k] != v:
                section_delta[k] = v
        if section_delta:
            delta[section] = section_delta
    return delta


def save_user(data: dict):
    """Save only user overrides (delta from defaults) to /data/deep_config.json."""
    defaults = get_defaults()
    delta = _compute_delta(defaults, data)
    _USER_FILE.parent.mkdir(parents=True, exist_ok=True)
    _USER_FILE.write_text(json.dumps(delta, indent=2))
    reload()


SCHEMA = {
    "quality": {
        "sharpness_variance_divisor": {"type": "float", "min": 100,   "max": 20000, "step": 100},
        "brightness_target":          {"type": "float", "min": 0.0,   "max": 1.0,   "step": 0.01},
        "megapixel_reference":        {"type": "float", "min": 4,     "max": 60,    "step": 1},
        "histogram_bins":             {"type": "int",   "min": 4,     "max": 32},
        "histogram_thumb_size":       {"type": "int",   "min": 16,    "max": 256},
        "weight_resolution":          {"type": "float", "min": 0.0,   "max": 1.0,   "step": 0.05},
        "weight_sharpness":           {"type": "float", "min": 0.0,   "max": 1.0,   "step": 0.05},
        "weight_brightness":          {"type": "float", "min": 0.0,   "max": 1.0,   "step": 0.05},
    },
    "face": {
        "min_face_size":           {"type": "float", "min": 0.001, "max": 0.1,   "step": 0.001},
        "clip_check_margin":       {"type": "float", "min": 0.0,   "max": 0.2,   "step": 0.005},
        "clip_check_ar_tolerance": {"type": "float", "min": 0.0,   "max": 0.5,   "step": 0.01},
        "clip_check_overflow_min": {"type": "float", "min": 0.0,   "max": 0.1,   "step": 0.001},
        "prominent_threshold":     {"type": "float", "min": 0.005, "max": 0.15,  "step": 0.005},
        "pan_margin":              {"type": "float", "min": 0.0,   "max": 0.2,   "step": 0.01},
        "target_y_position":       {"type": "float", "min": 0.2,   "max": 0.7,   "step": 0.01},
        "pan_x_min":               {"type": "float", "min": 0,     "max": 49,    "step": 1},
        "pan_x_max":               {"type": "float", "min": 51,    "max": 100,   "step": 1},
        "close_up_threshold":      {"type": "float", "min": 0.1,   "max": 0.7,   "step": 0.05},
        "lateral_position_min":    {"type": "float", "min": 0.0,   "max": 0.3,   "step": 0.01},
        "lateral_position_max":    {"type": "float", "min": 0.7,   "max": 1.0,   "step": 0.01},
        "vertical_position_min":   {"type": "float", "min": 0.0,   "max": 0.2,   "step": 0.01},
        "vertical_position_max":   {"type": "float", "min": 0.5,   "max": 1.0,   "step": 0.01},
        "large_face_threshold":    {"type": "float", "min": 0.05,  "max": 0.6,   "step": 0.05},
    },
    "duplicates": {
        "dhash_size":               {"type": "int",   "min": 4,  "max": 16},
        "burst_time_window_base_sec": {"type": "int", "min": 30, "max": 7200},
        "gps_coord_rounding":       {"type": "int",   "min": 1,  "max": 6},
    },
    "layout_scoring": {
        "penalty_orientation_violation": {"type": "int",   "min": 0, "max": 50000, "step": 500},
        "penalty_empty_caption_slot":    {"type": "int",   "min": 0, "max": 20000, "step": 500},
        "bonus_caption_match":           {"type": "int",   "min": 0, "max": 1000,  "step": 10},
        "penalty_caption_no_slot":       {"type": "int",   "min": 0, "max": 2000,  "step": 10},
        "penalty_empty_photo_slot":      {"type": "int",   "min": 0, "max": 2000,  "step": 10},
        "penalty_density_deviation":     {"type": "int",   "min": 0, "max": 500,   "step": 5},
        "face_clip_penalty_min_size":    {"type": "float", "min": 0.0, "max": 0.5, "step": 0.01},
        "face_clip_penalty_weight":      {"type": "int",   "min": 0, "max": 2000,  "step": 10},
        "layout_reuse_penalty":          {"type": "int",   "min": 0, "max": 100},
        "unused_layout_bonus":           {"type": "int",   "min": 0, "max": 200},
        "rhythm_alternation_penalty":    {"type": "int",   "min": 0, "max": 50},
    },
    "map": {
        "marker_color":              {"type": "color"},
        "marker_size":               {"type": "int",   "min": 3,   "max": 40},
        "route_width":               {"type": "int",   "min": 1,   "max": 10},
        "background_color":          {"type": "color"},
        "grid_color":                {"type": "color"},
        "grid_lines":                {"type": "int",   "min": 0,   "max": 20},
        "bbox_padding_deg":          {"type": "float", "min": 0.0, "max": 1.0,  "step": 0.005},
        "single_location_expand_deg":    {"type": "float", "min": 0.0, "max": 1.0,  "step": 0.005},
        "single_location_threshold_deg": {"type": "float", "min": 0.0, "max": 0.5,  "step": 0.001},
    },
    "pdf": {
        "jpeg_quality":                  {"type": "int",   "min": 50,  "max": 100},
        "max_text_lines":                {"type": "int",   "min": 1,   "max": 50},
        "bleed_mark_length_mm":          {"type": "float", "min": 2,   "max": 15,  "step": 0.5},
        "bleed_mark_gap_mm":             {"type": "float", "min": 0.5, "max": 5,   "step": 0.5},
        "default_line_opacity_pct":      {"type": "int",   "min": 0,   "max": 100},
        "default_element_font_size_pct": {"type": "int",   "min": 1,   "max": 10},
        "title_page_map_height_frac":    {"type": "float", "min": 0.2, "max": 0.9, "step": 0.05},
        "title_page_gradient_steps":     {"type": "int",   "min": 5,   "max": 50},
        "title_font_size_mm":            {"type": "float", "min": 6,   "max": 30,  "step": 0.5},
        "caption_font_size_factor":      {"type": "float", "min": 0.2, "max": 1.0, "step": 0.01},
    },
    "svg": {
        "max_image_dimension_px":   {"type": "int",   "min": 800,  "max": 8000, "step": 100},
        "jpeg_quality":             {"type": "int",   "min": 50,   "max": 100},
        "title_page_map_opacity":   {"type": "float", "min": 0.1,  "max": 1.0,  "step": 0.05},
        "title_font_size":          {"type": "int",   "min": 10,   "max": 60},
        "description_font_size":    {"type": "int",   "min": 6,    "max": 30},
        "min_caption_font_size":    {"type": "float", "min": 4,    "max": 20,   "step": 0.5},
        "char_width_factor":        {"type": "float", "min": 0.3,  "max": 0.9,  "step": 0.01},
        "crop_mark_length_mm":      {"type": "float", "min": 2,    "max": 15,   "step": 0.5},
        "crop_mark_gap_mm":         {"type": "float", "min": 0.5,  "max": 5,    "step": 0.5},
    },
    "performance": {
        "max_hires_photos":             {"type": "int", "min": 50,  "max": 2000, "step": 50},
        "concurrent_hires_downloads":   {"type": "int", "min": 1,   "max": 20},
        "concurrent_thumb_downloads":   {"type": "int", "min": 1,   "max": 30},
        "pdf_timeout_per_page_sec":     {"type": "int", "min": 2,   "max": 60},
        "pdf_min_timeout_sec":          {"type": "int", "min": 60,  "max": 3600, "step": 60},
    },
}
