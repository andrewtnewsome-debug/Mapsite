// The page loads React from cdnjs as a global; shared repo components import "react", so point them here.
const R = (window as unknown as { React: typeof import("react") }).React;
export default R;
export const { useState, useEffect, useRef, useMemo, useCallback, startTransition, Fragment, createElement } = R;
