/**
 * WebGL Edge Shader — Vertex Stage
 *
 * GPU-accelerated Bezier curves for 77k+ edges at 60Hz.
 * Impact score passed as vertex attribute for real-time color mapping.
 *
 * DO-330 TQL-5: Deterministic rendering (no random in shader).
 */

attribute vec2 uv;           // 0.0 to 1.0 along the curve
attribute vec3 sourcePos;
attribute vec3 targetPos;
attribute float impactScore;

uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;

varying float vImpact;

void main() {
  vImpact = impactScore;

  // Quadratic Bezier: source → midpoint → target
  // "Tactical Sag" pulls midpoint down for visual hierarchy
  vec3 midPoint = (sourcePos + targetPos) * 0.5;
  midPoint.y -= 30.0;

  // De Casteljau interpolation (quadratic Bezier)
  vec3 p0 = mix(sourcePos, midPoint, uv.x);
  vec3 p1 = mix(midPoint, targetPos, uv.x);
  vec3 pos = mix(p0, p1, uv.x);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
