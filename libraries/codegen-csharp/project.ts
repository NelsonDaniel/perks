/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Initializer } from '@microsoft.azure/codegen';
import { pall } from '@microsoft.azure/codegen';
import { Namespace } from './namespace';

export class Project extends Initializer {


  private namespaces = new Array<Namespace>();
  constructor(objectInitializer?: Partial<Project>) {
    super();
    this.apply(objectInitializer);
  }

  public addNamespace(n: Namespace): Namespace {
    this.namespaces.push(n);
    return n;
  }

  public async init(): Promise<this> {
    return this;
  }

  public async writeFiles(writer: (filename: string, content: string) => Promise<void>) {
    await pall(this.namespaces, async ns => ns.writeFiles(writer));
  }
}