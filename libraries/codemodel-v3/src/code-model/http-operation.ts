/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Components, Example, ExternalDocumentation, ImplementationDetails, ImplementationLocation, IOperation, IOperationBase, IParameter, LanguageDetails, Link, ParameterDetails, ResponseDetails, SecurityRequirement, Server } from './components';
import { Extensions } from './extensions';
import { Schema } from './schema';
import { SecurityScheme } from './security-scheme';
import { DeepPartial, Dictionary } from '@microsoft.azure/codegen';
import { uid } from './uid';

export interface HttpOperationDetails extends ImplementationDetails {
}

export class Encoding extends Extensions implements Encoding {
  public headers = new Dictionary<Header>();

  constructor(initializer?: Partial<Encoding>) {
    super();
    this.apply(initializer);
  }
}

export class Header extends Extensions implements Header {

  public content = new Dictionary<MediaType>();

  constructor(initializer?: Partial<Header>) {
    super();
    this.apply(initializer);
  }
}

export class MediaType extends Extensions implements MediaType {

  public encoding = new Dictionary<Encoding>();
  public accepts = new Array<string>();

  constructor(initializer?: Partial<MediaType>) {
    super();
    this.apply(initializer);
  }
}

export class RequestBody extends Extensions implements RequestBody {

  constructor(initializer?: Partial<RequestBody>) {
    super();
    this.apply(initializer);
  }
}

export class Response extends Extensions implements Response {

  public content = new Dictionary<MediaType>();
  public links = new Dictionary<Link>();
  public headers = new Dictionary<Header>();

  constructor(public description: string, initializer?: Partial<Response>) {
    super();
    this.apply(initializer);
  }
}

export enum ParameterLocation {
  Query = 'query',
  Header = 'header',
  Cookie = 'cookie',
  Path = 'path',
}

export enum EncodingStyle {
  Matrix = 'matrix',
  Label = 'label',
  Simple = 'simple',
  Form = 'form',
  SpaceDelimited = 'spaceDelimited',
  PipeDelimited = 'pipeDelimited',
  DeepObject = 'deepObject'
}

export type QueryEncodingStyle =
  EncodingStyle.Form
  | EncodingStyle.SpaceDelimited
  | EncodingStyle.PipeDelimited
  | EncodingStyle.DeepObject;
export type PathEncodingStyle = EncodingStyle.Matrix | EncodingStyle.Label | EncodingStyle.Simple;

export interface Encoding extends Extensions {
  contentType?: string;
  headers: Dictionary<Header>;
  style?: QueryEncodingStyle;
  explode?: boolean;
  allowReserved?: boolean;
}

export interface Header extends Extensions {

  schema: Schema;
  explode?: boolean;
  examples: Dictionary<Example>;

  description?: string;
  required: boolean;
  deprecated: boolean;
  allowEmptyValue: boolean;
  allowReserved: boolean;
}

export interface MediaType extends Extensions {
  accepts: Array<string>; // equivalent media types for this media type (ie, text/json, application/json)
  examples: Dictionary<Example>;
  encoding: Dictionary<Encoding>;
  schema?: Schema;
}

export interface RequestBody extends Extensions {
  description?: string;
  contentType: string;
  schema: Schema;
  required: boolean;
}

export interface Response extends Extensions {
  description: string;
  headers: Dictionary<Header>;
  content: Dictionary<MediaType>;
  links: Dictionary<Link>;
}

export interface HttpParameterDetails extends ParameterDetails {
  location: ImplementationLocation;
}

export enum HttpMethod {
  Get = 'get',
  Put = 'put',
  Post = 'post',
  Delete = 'delete',
  Options = 'options',
  Head = 'head',
  Patch = 'patch',
  Trace = 'trace'
}

export interface NewResponse {
  details: LanguageDetails<ResponseDetails>;
  responseCode: string;
  description: string;
  headers: Dictionary<Header>;
  headerSchema?: Schema;
  mimeTypes: Array<string>; // accepted equivalent media types for this media type (ie, text/json, application/json)
  schema?: Schema;
}

export class NewResponse extends Extensions implements NewResponse {
  public details: LanguageDetails<ResponseDetails>;

  constructor(public responseCode: string, public description: string, public mimeTypes: Array<string>, objectInitializer?: Partial<NewResponse>) {
    super();
    this.details = {
      default: {
        uid: `response:${uid()}`,
        isErrorResponse: false,
        description: 'MISSING DESCRIPTION 09',
        name: `${responseCode} ${mimeTypes.join(' ')}`,
      }
    };
    this.headers = new Dictionary<Header>();
    this.apply(objectInitializer);
  }
}

export class HttpOperation extends Extensions implements HttpOperation {
  public details: LanguageDetails<HttpOperationDetails>;
  public tags = new Array<string>();
  public parameters = new Array<HttpOperationParameter>();
  public responses = new Dictionary<Array<NewResponse>>();
  public callbacks = new Dictionary<Callback>();
  public security = new Array<SecurityRequirement>();
  public servers = new Array<Server>();
  public deprecated = false;

  constructor(operationId: string, public path: string, public method: HttpMethod, initializer?: DeepPartial<HttpOperation>) {
    super();
    this.details = {
      default: {
        uid: `http-operation:${uid()}`,
        description: 'MISSING DESCRIPTION 05',
        name: operationId,
      }
    };

    this.apply(initializer);
  }
}

export interface HttpOperation extends IOperation<HttpOperationParameter>, Extensions {
  details: LanguageDetails<HttpOperationDetails>;

  tags: Array<string>;
  summary?: string;

  externalDocs?: ExternalDocumentation;

  parameters: Array<HttpOperationParameter>;
  requestBody?: RequestBody;
  // responses: Dictionary<Response>;
  responses: Dictionary<Array<NewResponse>>;

  callbacks: Dictionary<Callback>;
  deprecated: boolean;
  security: Array<SecurityRequirement>;
  servers: Array<Server>;

  path: string;
  method: HttpMethod;
  pathDescription?: string;
  pathSummary?: string;
  pathExtensions?: Dictionary<any>;
}

export interface HttpOperationParameter extends IParameter {

  in: ParameterLocation;
  explode?: boolean;

  encoding?: Dictionary<Encoding>;
  mediaType?: string;
  style: EncodingStyle;
  examples?: Dictionary<any>;
  allowReserved?: boolean;
}

export class HttpOperationParameter extends Extensions implements HttpOperationParameter {

  public details: LanguageDetails<HttpParameterDetails>;
  public deprecated = false;
  public required = false;
  public allowEmptyValue = false;

  constructor(public name: string, inWhere: ParameterLocation, implementation: ImplementationLocation, initializer?: Partial<HttpOperationParameter>) {
    super();
    this.in = inWhere;
    this.details = {
      default: {
        uid: `http-parameter:${uid()}`,
        description: 'MISSING DESCRIPTION 06',
        location: implementation,
        name,
      }
    };
    this.required = inWhere === ParameterLocation.Path;
    this.apply(initializer);
  }
}

export function isHttpOperation(operation: IOperationBase): operation is HttpOperation {
  if ((<any>operation).path) {
    return true;
  }
  return false;
}

export class Callback implements Callback {
  constructor() {
    // unimplemented.
  }
}

export interface Callback extends Dictionary<HttpOperation> {
}

export interface HttpComponents extends Components<HttpOperation, HttpOperationParameter> {
  responses: Dictionary<Response>;
  examples: Dictionary<Example>;
  requestBodies: Dictionary<RequestBody>;
  headers: Dictionary<Header>;
  securitySchemes: Dictionary<SecurityScheme>;
  links: Dictionary<Link>;
  callbacks: Dictionary<Callback>;
}

export class HttpComponents extends Components<HttpOperation, HttpOperationParameter> implements HttpComponents {
  public responses = new Dictionary<Response>();
  public examples = new Dictionary<Example>();

  public requestBodies = new Dictionary<RequestBody>();
  public headers = new Dictionary<Header>();
  public securitySchemes = new Dictionary<SecurityScheme>();

  public links = new Dictionary<Link>();

  public callbacks = new Dictionary<Callback>();

  constructor(initializer?: Partial<HttpComponents>) {
    super();
    this.apply(initializer);
  }
}
