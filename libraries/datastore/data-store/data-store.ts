/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { OperationCanceledException } from '@microsoft.azure/tasks';
import { EnsureIsFolderUri, ReadUri, ResolveUri, WriteString, ParentFolderUri } from '@microsoft.azure/uri';
import { MappedPosition, MappingItem, Position, RawSourceMap, SourceMapConsumer, SourceMapGenerator } from 'source-map';
import { CancellationToken } from '../cancellation';
import { IFileSystem } from '../file-system';
import { Lazy } from '../lazy';
import { LineIndices } from '../parsing/text-utility';
import { FastStringify, ParseNode, ParseToAst as parseAst, YAMLNode } from '../yaml';
import { BlameTree } from '../source-map/blaming';
import { Compile, CompilePosition, Mapping, SmartPosition } from '../source-map/source-map';

const FALLBACK_DEFAULT_OUTPUT_ARTIFACT = '';

/********************************************
 * Data model section (not exposed)
 ********************************************/

export interface Metadata {
  artifactType: string;
  inputSourceMap: Lazy<RawSourceMap>;
  sourceMap: Lazy<RawSourceMap>;
  sourceMapEachMappingByLine: Lazy<Array<Array<MappingItem>>>;
  yamlAst: Lazy<YAMLNode>;
  lineIndices: Lazy<Array<number>>;
}

export interface Data {
  data: string;
  metadata: Metadata;
  identity: Array<string>;
}

interface Store { [uri: string]: Data; }

/********************************************
 * Central data controller
 * - one stop for creating data
 * - ensures WRITE ONCE model
 ********************************************/

export abstract class DataSource {
  public skip: boolean | undefined;
  public abstract Enum(): Promise<Array<string>>;
  public abstract Read(uri: string): Promise<DataHandle | null>;

  public async ReadStrict(uri: string): Promise<DataHandle> {
    const result = await this.Read(uri);
    if (result === null) {
      throw new Error(`Could not read '${uri}'.`);
    }
    return result;
  }

  public async Dump(targetDirUri: string): Promise<void> {
    targetDirUri = EnsureIsFolderUri(targetDirUri);
    const keys = await this.Enum();
    for (const key of keys) {
      const dataHandle = await this.ReadStrict(key);
      const data = dataHandle.ReadData();
      const metadata = dataHandle.metadata;
      const targetFileUri = ResolveUri(
        targetDirUri,
        key.replace(':', '')); // make key (URI) a descriptive relative path
      await WriteString(targetFileUri, data);
      await WriteString(targetFileUri + '.map', JSON.stringify(metadata.sourceMap.Value, null, 2));
      await WriteString(targetFileUri + '.input.map', JSON.stringify(metadata.inputSourceMap.Value, null, 2));
    }
  }
}

export class QuickDataSource extends DataSource {
  public constructor(private handles: Array<DataHandle>, skip?: boolean) {
    super();
    this.skip = skip;
  }

  public async Enum(): Promise<Array<string>> {
    return this.skip ? new Array<string>() : this.handles.map(x => x.key);
  }

  public async Read(key: string): Promise<DataHandle | null> {
    if (this.skip) {
      return null;
    }
    const data = this.handles.filter(x => x.key === key)[0];
    return data || null;
  }
}

class ReadThroughDataSource extends DataSource {
  private uris: Array<string> = [];
  private cache: { [uri: string]: Promise<DataHandle | null> } = {};

  constructor(private store: DataStore, private fs: IFileSystem) {
    super();
  }

  public async Read(uri: string): Promise<DataHandle | null> {
    // sync cache (inner stuff is racey!)
    if (!this.cache[uri]) {
      this.cache[uri] = (async () => {
        // probe data store
        try {
          const existingData = await this.store.Read(uri);
          this.uris.push(uri);
          return existingData;
        } catch (e) {
        }

        // populate cache
        let data: string | null = null;
        try {
          data = await this.fs.ReadFile(uri) || await ReadUri(uri);
          if (data) {
            const parent = ParentFolderUri(uri) || '';
            // hack to let $(this-folder) resolve to the location...
            data = data.replace(/\$\(this-folder\)/g, parent);
          }
        } finally {
          if (!data) {
            return null;
          }
        }
        const readHandle = await this.store.WriteData(uri, data, 'input-file', [uri]);

        this.uris.push(uri);
        return readHandle;
      })();
    }

    return this.cache[uri];
  }

  public async Enum(): Promise<Array<string>> {
    return this.uris;
  }
}

export class DataStore {
  public static readonly BaseUri = 'mem://';
  public readonly BaseUri = DataStore.BaseUri;
  private store: Store = {};

  public constructor(private cancellationToken: CancellationToken = CancellationToken.None) {
  }

  private ThrowIfCancelled(): void {
    if (this.cancellationToken.isCancellationRequested) {
      throw new OperationCanceledException();
    }
  }

  public GetReadThroughScope(fs: IFileSystem): DataSource {
    return new ReadThroughDataSource(this, fs);
  }

  /****************
   * Data access
   ***************/

  private uid = 0;

  private async WriteDataInternal(uri: string, data: string, metadata: Metadata, identity: Array<string>): Promise<DataHandle> {
    this.ThrowIfCancelled();
    if (this.store[uri]) {
      throw new Error(`can only write '${uri}' once`);
    }
    this.store[uri] = {
      data,
      metadata,
      identity
    };

    return this.Read(uri);
  }

  public async WriteData(description: string, data: string, artifact: string, identity: Array<string>, sourceMapFactory?: (self: DataHandle) => RawSourceMap): Promise<DataHandle> {
    const uri = this.createUri(description);

    // metadata
    const metadata: Metadata = <any>{};
    const result = await this.WriteDataInternal(uri, data, metadata, identity);
    metadata.artifactType = artifact;
    metadata.sourceMap = new Lazy(() => {
      if (!sourceMapFactory) {
        return new SourceMapGenerator().toJSON();
      }
      const sourceMap = sourceMapFactory(result);

      // validate
      const inputFiles = sourceMap.sources.concat(sourceMap.file);
      for (const inputFile of inputFiles) {
        if (!this.store[inputFile]) {
          throw new Error(`Source map of '${uri}' references '${inputFile}' which does not exist`);
        }
      }

      return sourceMap;
    });
    metadata.sourceMapEachMappingByLine = new Lazy<Array<Array<MappingItem>>>(() => {
      const result: Array<Array<MappingItem>> = [];
      const sourceMapConsumer = new SourceMapConsumer(metadata.sourceMap.Value);

      // does NOT support multiple sources :(
      // `singleResult` has null-properties if there is no original

      // get coinciding sources
      sourceMapConsumer.eachMapping(mapping => {
        while (result.length <= mapping.generatedLine) {
          result.push([]);
        }
        result[mapping.generatedLine].push(mapping);
      });

      return result;
    });
    metadata.inputSourceMap = new Lazy(() => this.CreateInputSourceMapFor(uri));
    metadata.yamlAst = new Lazy<YAMLNode>(() => parseAst(data));
    metadata.lineIndices = new Lazy<Array<number>>(() => LineIndices(data));
    return result;
  }

  private createUri(description: string): string {
    return ResolveUri(this.BaseUri, `${this.uid++}?${encodeURIComponent(description)}`);
  }

  public getDataSink(defaultArtifact: string = FALLBACK_DEFAULT_OUTPUT_ARTIFACT): DataSink {
    return new DataSink(
      (description, data, artifact, identity, sourceMapFactory) => this.WriteData(description, data, artifact || defaultArtifact, identity, sourceMapFactory),
      async (description, input) => {
        const uri = this.createUri(description);
        this.store[uri] = this.store[input.key];
        return this.Read(uri);
      }
    );
  }

  public ReadStrictSync(absoluteUri: string): DataHandle {
    const entry = this.store[absoluteUri];
    if (entry === undefined) {
      throw new Error(`Object '${absoluteUri}' does not exist.`);
    }
    return new DataHandle(absoluteUri, entry);
  }

  public async Read(uri: string): Promise<DataHandle> {
    uri = ResolveUri(this.BaseUri, uri);
    const data = this.store[uri];
    if (!data) {
      throw new Error(`Could not read '${uri}'.`);
    }
    return new DataHandle(uri, data);
  }

  public Blame(absoluteUri: string, position: SmartPosition): BlameTree {
    const data = this.ReadStrictSync(absoluteUri);
    const resolvedPosition = CompilePosition(position, data);
    return BlameTree.Create(this, {
      source: absoluteUri,
      column: resolvedPosition.column,
      line: resolvedPosition.line,
      name: `blameRoot (${JSON.stringify(position)})`
    });
  }

  private CreateInputSourceMapFor(absoluteUri: string): RawSourceMap {
    const data = this.ReadStrictSync(absoluteUri);

    // retrieve all target positions
    const targetPositions: Array<SmartPosition> = [];
    const metadata = data.metadata;
    const sourceMapConsumer = new SourceMapConsumer(metadata.sourceMap.Value);
    sourceMapConsumer.eachMapping(m => targetPositions.push(<Position>{ column: m.generatedColumn, line: m.generatedLine }));

    // collect blame
    const mappings: Array<Mapping> = [];
    for (const targetPosition of targetPositions) {
      const blameTree = this.Blame(absoluteUri, targetPosition);
      const inputPositions = blameTree.BlameLeafs();
      for (const inputPosition of inputPositions) {
        mappings.push({
          name: inputPosition.name,
          source: this.ReadStrictSync(inputPosition.source).Description, // friendly name
          generated: blameTree.node,
          original: inputPosition
        });
      }
    }
    const sourceMapGenerator = new SourceMapGenerator({ file: absoluteUri });
    Compile(mappings, sourceMapGenerator);
    return sourceMapGenerator.toJSON();
  }
}

/********************************************
 * Data handles
 * - provide well-defined access to specific data
 * - provide convenience methods
 ********************************************/

export class DataSink {
  constructor(
    private write: (description: string, rawData: string, artifact: string | undefined, identity: Array<string>, metadataFactory: (readHandle: DataHandle) => RawSourceMap) => Promise<DataHandle>,
    private forward: (description: string, input: DataHandle) => Promise<DataHandle>) {
  }

  public async WriteDataWithSourceMap(description: string, data: string, artifact: string | undefined, identity: Array<string>, sourceMapFactory: (readHandle: DataHandle) => RawSourceMap): Promise<DataHandle> {
    return this.write(description, data, artifact, identity, sourceMapFactory);
  }

  public async WriteData(description: string, data: string, identity: Array<string>, artifact?: string, mappings: Array<Mapping> = [], mappingSources: Array<DataHandle> = []): Promise<DataHandle> {
    return this.WriteDataWithSourceMap(description, data, artifact, identity, readHandle => {
      const sourceMapGenerator = new SourceMapGenerator({ file: readHandle.key });
      Compile(mappings, sourceMapGenerator, mappingSources.concat(readHandle));
      return sourceMapGenerator.toJSON();
    });
  }

  public WriteObject<T>(description: string, obj: T, identity: Array<string>, artifact?: string, mappings: Array<Mapping> = [], mappingSources: Array<DataHandle> = []): Promise<DataHandle> {
    return this.WriteData(description, FastStringify(obj), identity, artifact, mappings, mappingSources);
  }

  public Forward(description: string, input: DataHandle): Promise<DataHandle> {
    return this.forward(description, input);
  }
}

export class DataHandle {
  constructor(public readonly key: string, private read: Data) {
  }

  public get originalDirectory() {
    const id = this.identity[0];
    return id.substring(0, id.lastIndexOf('/'));
  }

  public get originalFullPath() {
    return this.identity[0];
  }

  public get identity() {
    return this.read.identity;
  }

  public ReadData(): string {
    return this.read.data;
  }

  public get metadata(): Metadata {
    return this.read.metadata;
  }

  public ReadObject<T>(): T {
    return ParseNode<T>(this.ReadYamlAst());
  }

  public ReadYamlAst(): YAMLNode {
    return this.metadata.yamlAst.Value;
  }

  public get artifactType(): string {
    return this.metadata.artifactType;
  }

  public get Description(): string {
    return decodeURIComponent(this.key.split('?').reverse()[0]);
  }

  public IsObject(): boolean {
    try {
      this.ReadObject();
      return true;
    } catch (e) {
      return false;
    }
  }

  public Blame(position: Position): Array<MappedPosition> {
    const metadata = this.metadata;
    const sameLineResults = (metadata.sourceMapEachMappingByLine.Value[position.line] || [])
      .filter(mapping => mapping.generatedColumn <= position.column);
    const maxColumn = sameLineResults.reduce((c, m) => Math.max(c, m.generatedColumn), 0);
    const columnDelta = position.column - maxColumn;
    return sameLineResults.filter(m => m.generatedColumn === maxColumn).map(m => {
      return {
        column: m.originalColumn + columnDelta,
        line: m.originalLine,
        name: m.name,
        source: m.source
      };
    });
  }
}
