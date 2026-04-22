/**
 * WebGL Edge Shader — Fragment Stage
 *
 * NVIS 2026 color ramp: Cyan (healthy) → Amber (degraded) → Red (critical)
 * Alpha glow increases with impact for visual salience.
 *
 * DO-178C compliance: No random, deterministic output.
 */

precision mediump float;

varying float vImpact;

void main() {
  // NVIS 2026 color palette
  vec3 healthyColor = vec3(0.0, 0.81, 1.0);   // Cyan #00CFFF
  vec3 warningColor = vec3(1.0, 0.75, 0.0);   // Amber #FFBF00
  vec3 criticalColor = vec3(0.86, 0.15, 0.15); // Red #DB2626

  // Three-stage color ramp
  vec3 finalColor;
  if (vImpact < 0.3) {
    // Healthy → Warning transition
    finalColor = mix(healthyColor, warningColor, vImpact / 0.3);
  } else if (vImpact < 0.7) {
    // Warning → Critical transition
    finalColor = mix(warningColor, criticalColor, (vImpact - 0.3) / 0.4);
  } else {
    // Full critical
    finalColor = criticalColor;
  }

  // Alpha glow: 0.4 base + 0.4 boost at max impact
  float alpha = 0.4 + (vImpact * 0.4);

  gl_FragColor = vec4(finalColor, alpha);
}
