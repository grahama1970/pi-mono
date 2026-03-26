//! Rust hotspots for /extract-tables skill.
//!
//! Provides PyO3-exported functions for:
//! - Image processing (adaptive threshold, morphology, contour detection)
//! - Geometry utilities (line merging, bbox math, coordinate scaling)
//! - pdf_oxide bridge (text extraction + layout analysis)

use pyo3::prelude::*;

mod geometry;
mod image_proc;

/// Python module entry point.
#[pymodule]
fn extract_tables_rs(m: &Bound<'_, PyModule>) -> PyResult<()> {
    // Geometry functions
    m.add_function(wrap_pyfunction!(geometry::merge_close_lines, m)?)?;
    m.add_function(wrap_pyfunction!(geometry::scale_coordinates, m)?)?;
    m.add_function(wrap_pyfunction!(geometry::segments_in_bbox, m)?)?;
    m.add_function(wrap_pyfunction!(geometry::text_in_bbox, m)?)?;
    m.add_function(wrap_pyfunction!(geometry::flag_font_size, m)?)?;

    // Image processing
    m.add_function(wrap_pyfunction!(image_proc::adaptive_threshold_image, m)?)?;
    m.add_function(wrap_pyfunction!(image_proc::find_lines, m)?)?;
    m.add_function(wrap_pyfunction!(image_proc::find_contours_in_image, m)?)?;
    m.add_function(wrap_pyfunction!(image_proc::find_joints, m)?)?;
    m.add_function(wrap_pyfunction!(image_proc::morphological_open_image, m)?)?;

    Ok(())
}
