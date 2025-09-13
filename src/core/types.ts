/**
 * Shared type definitions for dependency tracking and analysis
 */

/**
 * Represents a step in a dependency path chain
 */
export interface DependencyPathStep {
  package: string;
  type: string;
  specifier: string;
}

/**
 * Complete dependency information including path and type summary
 */
export interface DependencyInfo {
  typeSummary: string;
  path: DependencyPathStep[];
  allPaths?: DependencyPathStep[][]; // Optional field for multiple paths in diamond dependencies
}

export interface DependencyTreeNode {
  package: string;
  type?: string;
  specifier?: string;
  children: Map<string, DependencyTreeNode>;
}

/**
 * Information about a linked dependency relationship
 */
export interface LinkedDependencyInfo {
  sourceImporter: string; // 'apps/web'
  linkName: string; // '@my/logger'
  resolvedImporter: string; // 'packages/logger'
}

/**
 * Dependency information for tracking which importers use a package
 */
export interface PackageDependencyInfo {
  importers: Set<string>;
  directDependents: Set<string>; // Packages that directly depend on this package
}
