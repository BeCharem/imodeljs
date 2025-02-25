/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
/** @packageDocumentation
 * @module Metadata
 */

import { SchemaContext } from "../Context";
import { SchemaReadHelper } from "../Deserialization/Helper";
import { JsonParser } from "../Deserialization/JsonParser";
import { SchemaProps } from "../Deserialization/JsonProps";
import { XmlSerializationUtils } from "../Deserialization/XmlSerializationUtils";
import { ECClassModifier, PrimitiveType } from "../ECObjects";
import { ECObjectsError, ECObjectsStatus } from "../Exception";
import { AnyClass, AnySchemaItem, SchemaInfo } from "../Interfaces";
import { ECVersion, SchemaItemKey, SchemaKey } from "../SchemaKey";
import { ECName } from "../ECName";
import { ECClass, StructClass } from "./Class";
import { Constant } from "./Constant";
import { CustomAttribute, CustomAttributeContainerProps, CustomAttributeSet, serializeCustomAttributes } from "./CustomAttribute";
import { CustomAttributeClass } from "./CustomAttributeClass";
import { EntityClass } from "./EntityClass";
import { Enumeration } from "./Enumeration";
import { Format } from "./Format";
import { InvertedUnit } from "./InvertedUnit";
import { KindOfQuantity } from "./KindOfQuantity";
import { Mixin } from "./Mixin";
import { Phenomenon } from "./Phenomenon";
import { PropertyCategory } from "./PropertyCategory";
import { RelationshipClass } from "./RelationshipClass";
import { SchemaItem } from "./SchemaItem";
import { Unit } from "./Unit";
import { UnitSystem } from "./UnitSystem";

const SCHEMAURL3_2_JSON = "https://dev.bentley.com/json_schemas/ec/32/ecschema";
const SCHEMAURL3_2_XML = "http://www.bentley.com/schemas/Bentley.ECXML.3.2";

/**
 * @beta
 */
export class Schema implements CustomAttributeContainerProps {
  private _context: SchemaContext;
  protected _schemaKey?: SchemaKey;
  protected _alias?: string;
  protected _label?: string;
  protected _description?: string;
  public readonly references: Schema[];
  private readonly _items: Map<string, SchemaItem>;
  private _customAttributes?: Map<string, CustomAttribute>;
  /**
   * Constructs an empty Schema with the given name and version in the provided context.
   * @param context The SchemaContext that will control the lifetime of the schema
   * @param name The schema's name
   * @param readVersion The integer read (major) version of the schema
   * @param writeVersion The integer write version of the schema
   * @param minorVersion The integer minor version of the schema
   */
  constructor(context: SchemaContext, name: string, alias: string, readVersion: number, writeVersion: number, minorVersion: number);
  /**
   * Constructs an empty Schema with the given key in the provided context.
   * @param context The SchemaContext that will control the lifetime of the schema
   * @param key A SchemaKey that uniquely identifies the schema
   */
  constructor(context: SchemaContext, key: SchemaKey, alias: string);  // eslint-disable-line @typescript-eslint/unified-signatures
  /**
   * Constructs an empty Schema (without a SchemaKey) in the provided context.
   * This should only be used when the schema name and version will be deserialized (via `fromJson()`) immediately after this Schema is instantiated.
   * @param context The SchemaContext that will control the lifetime of the schema
   * @internal
   */
  constructor(context: SchemaContext);
  /** @internal */
  constructor(context: SchemaContext, nameOrKey?: SchemaKey | string, alias?: string, readVer?: number, writeVer?: number, minorVer?: number) {
    this._schemaKey = (typeof (nameOrKey) === "string") ? new SchemaKey(nameOrKey, new ECVersion(readVer as number, writeVer, minorVer)) : nameOrKey;
    this._context = context;
    this.references = [];
    this._items = new Map<string, SchemaItem>();

    if (alias !== undefined && ECName.validate(alias)) {
      this._alias = alias;
    } else if (nameOrKey !== undefined) {
      throw new ECObjectsError(ECObjectsStatus.InvalidECJson, `The Schema ${this.name} does not have the required 'alias' attribute.`);
    }
  }

  public get schemaKey() {
    if (undefined === this._schemaKey)
      throw new ECObjectsError(ECObjectsStatus.InvalidECJson, `The schema '${this.name}' has an invalid SchemaKey.`);
    return this._schemaKey;
  }

  public get name() { return this.schemaKey.name; }

  public get readVersion() { return this.schemaKey.readVersion; }

  public get writeVersion() { return this.schemaKey.writeVersion; }

  public get minorVersion() { return this.schemaKey.minorVersion; }

  public get alias() {
    if (this._alias === undefined || this._alias === null) {
      throw new ECObjectsError(ECObjectsStatus.InvalidECJson, `The Schema ${this.name} does not have the required 'alias' attribute.`);
    } else { return this._alias; }
  }

  public get label() { return this._label; }

  public get description() { return this._description; }

  public get customAttributes(): CustomAttributeSet | undefined { return this._customAttributes; }

  /** Returns the schema name. */
  public get fullName() { return this.schemaKey.name; }

  /** Returns the schema. */
  public get schema(): Schema { return this; }

  /** Returns the schema context this schema is within. */
  public get context(): SchemaContext { return this._context; }

  /**
   * Returns a SchemaItemKey given the item name and the schema it belongs to
   * @param fullName fully qualified name {Schema name}.{Item Name}
   */
  public getSchemaItemKey(fullName: string): SchemaItemKey {
    const [schemaName, itemName] = SchemaItem.parseFullName(fullName);
    let schemaKey = this.schemaKey;
    if (this.name !== schemaName) {
      const newSchemaRef = this.getReferenceSync(schemaName);
      if (undefined === newSchemaRef)
        throw new ECObjectsError(ECObjectsStatus.InvalidECJson, `Unable to find the referenced SchemaItem ${itemName}.`);
      schemaKey = newSchemaRef.schemaKey;
    }
    return new SchemaItemKey(itemName, schemaKey);
  }

  protected addItem<T extends SchemaItem>(item: T): void {
    if (undefined !== this.getItemSync(item.name))
      throw new ECObjectsError(ECObjectsStatus.DuplicateItem, `The SchemaItem ${item.name} cannot be added to the schema ${this.name} because it already exists`);

    this._items.set(item.name.toUpperCase(), item);
  }

  /**
   * @alpha
   */
  protected createClass<T extends AnyClass>(type: (new (_schema: Schema, _name: string, _modifier?: ECClassModifier) => T), name: string, modifier?: ECClassModifier): T {
    const item = new type(this, name, modifier);
    this.addItem(item);
    return item;
  }

  /**
   * Deletes a class from within this schema.
   * @param name the local (unqualified) class name, lookup is case-insensitive
   * @alpha
   */
  protected async deleteClass(name: string): Promise<void> {
    const schemaItem = await this.getItem(name);
    if (ECClass.isECClass(schemaItem)) {
      this._items.delete(name.toUpperCase());
    }
  }

  /**
   * Deletes a class from within this schema.
   * @param name the local (unqualified) class name, lookup is case-insensitive
   * @alpha
   */
  protected deleteClassSync(name: string): void {
    const schemaItem = this.getItemSync(name);
    if (ECClass.isECClass(schemaItem))
      this._items.delete(name.toUpperCase());
  }

  /**
   * Deletes a SchemaItem from within this schema.
   * @param name the local (unqualified) class name, lookup is case-insensitive
   * @alpha
   */
  protected async deleteSchemaItem(name: string): Promise<void> {
    const schemaItem = await this.getItem(name);
    if (SchemaItem.isSchemaItem(schemaItem)) {
      this._items.delete(name.toUpperCase());
    }
  }

  /**
   * Deletes a SchemaItem from within this schema.
   * @param name the local (unqualified) class name, lookup is case-insensitive
   * @alpha
   */
  protected deleteSchemaItemSync(name: string): void {
    const schemaItem = this.getItemSync(name);
    if (SchemaItem.isSchemaItem(schemaItem))
      this._items.delete(name.toUpperCase());
  }

  /**
   * @alpha
   */
  protected createItem<T extends AnySchemaItem>(type: (new (_schema: Schema, _name: string) => T), name: string): T {
    const item = new type(this, name);
    this.addItem(item);
    return item;
  }

  protected addCustomAttribute(customAttribute: CustomAttribute) {
    if (!this._customAttributes)
      this._customAttributes = new Map<string, CustomAttribute>();

    this._customAttributes.set(customAttribute.className, customAttribute);
  }

  /**
   * Creates a EntityClass with the provided name in this schema.
   * @param name
   * @param modifier
   */
  protected async createEntityClass(name: string, modifier?: ECClassModifier): Promise<EntityClass> {
    return this.createClass<EntityClass>(EntityClass, name, modifier);
  }

  protected createEntityClassSync(name: string, modifier?: ECClassModifier): EntityClass {
    return this.createClass<EntityClass>(EntityClass, name, modifier);
  }

  /**
   * Creates a Mixin with the provided name in this schema.
   * @param name
   */
  protected async createMixinClass(name: string): Promise<Mixin> { return this.createClass<Mixin>(Mixin, name); }
  protected createMixinClassSync(name: string): Mixin { return this.createClass<Mixin>(Mixin, name); }

  /**
   * Creates a StructClass with the provided name in this schema.
   * @param name
   * @param modifier
   */
  protected async createStructClass(name: string, modifier?: ECClassModifier): Promise<StructClass> {
    return this.createClass<StructClass>(StructClass, name, modifier);
  }

  protected createStructClassSync(name: string, modifier?: ECClassModifier): StructClass {
    return this.createClass<StructClass>(StructClass, name, modifier);
  }

  /**
   * Creates a CustomAttributeClass with the provided name in this schema.
   * @param name
   * @param modifier
   */
  protected async createCustomAttributeClass(name: string, modifier?: ECClassModifier): Promise<CustomAttributeClass> {
    return this.createClass<CustomAttributeClass>(CustomAttributeClass, name, modifier);
  }

  protected createCustomAttributeClassSync(name: string, modifier?: ECClassModifier): CustomAttributeClass {
    return this.createClass<CustomAttributeClass>(CustomAttributeClass, name, modifier);
  }

  /**
   * Creates a RelationshipClass with the provided name in this schema.
   * @param name
   * @param modifier
   */
  protected async createRelationshipClass(name: string, modifier?: ECClassModifier): Promise<RelationshipClass> {
    return this.createRelationshipClassSync(name, modifier);
  }

  protected createRelationshipClassSync(name: string, modifier?: ECClassModifier): RelationshipClass {
    return this.createClass<RelationshipClass>(RelationshipClass, name, modifier);
  }

  /**
   * Creates an Enumeration with the provided name in this schema.
   * @param name
   */
  protected async createEnumeration(name: string, primitiveType?: PrimitiveType.Integer | PrimitiveType.String): Promise<Enumeration> {
    return this.createEnumerationSync(name, primitiveType);
  }

  protected createEnumerationSync(name: string, primitiveType?: PrimitiveType.Integer | PrimitiveType.String): Enumeration {
    const item = new Enumeration(this, name, primitiveType);
    this.addItem(item);
    return item;
  }

  /**
   * Creates an KindOfQuantity with the provided name in this schema.
   * @param name
   */
  protected async createKindOfQuantity(name: string): Promise<KindOfQuantity> {
    return this.createKindOfQuantitySync(name);
  }

  protected createKindOfQuantitySync(name: string): KindOfQuantity {
    return this.createItem<KindOfQuantity>(KindOfQuantity, name);
  }

  /**
   * Creates a Constant with the provided name in this schema.
   * @param name
   */
  protected async createConstant(name: string): Promise<Constant> {
    return this.createItem<Constant>(Constant, name);
  }

  protected createConstantSync(name: string): Constant {
    return this.createItem<Constant>(Constant, name);
  }

  /**
   * Creates a Inverted Unit with the provided name in this schema.
   * @param name
   */
  protected async createInvertedUnit(name: string): Promise<InvertedUnit> {
    return this.createItem<InvertedUnit>(InvertedUnit, name);
  }

  protected createInvertedUnitSync(name: string): InvertedUnit {
    return this.createItem<InvertedUnit>(InvertedUnit, name);
  }

  /**
   * Creates an Format with the provided name in this schema.
   * @param name
   */
  protected async createFormat(name: string): Promise<Format> {
    return this.createItem<Format>(Format, name);
  }

  protected createFormatSync(name: string): Format {
    return this.createItem<Format>(Format, name);
  }

  /**
   * Creates a UnitSystem with the provided name in this schema.
   * @param name
   */
  protected async createUnitSystem(name: string): Promise<UnitSystem> {
    return this.createItem<UnitSystem>(UnitSystem, name);
  }

  protected createUnitSystemSync(name: string): UnitSystem {
    return this.createItem<UnitSystem>(UnitSystem, name);
  }

  /**
   * Creates a Phenomenon with the provided name in this schema.
   * @param name
   */
  protected async createPhenomenon(name: string): Promise<Phenomenon> {
    return this.createItem<Phenomenon>(Phenomenon, name);
  }

  protected createPhenomenonSync(name: string): Phenomenon {
    return this.createItem<Phenomenon>(Phenomenon, name);
  }

  /**
   * Creates a Unit with the provided name in this schema.
   * @param name
   */
  protected async createUnit(name: string): Promise<Unit> {
    return this.createItem<Unit>(Unit, name);
  }

  protected createUnitSync(name: string): Unit {
    return this.createItem<Unit>(Unit, name);
  }

  /**
   * Creates an PropertyCategory with the provided name in this schema.
   * @param name
   */
  protected async createPropertyCategory(name: string): Promise<PropertyCategory> {
    return this.createItem<PropertyCategory>(PropertyCategory, name);
  }

  protected createPropertyCategorySync(name: string): PropertyCategory {
    return this.createItem<PropertyCategory>(PropertyCategory, name);
  }
  /**
   *
   * @param refSchema
   */
  protected async addReference(refSchema: Schema): Promise<void> {
    // TODO validation of reference schema. For now just adding
    this.addReferenceSync(refSchema);
  }

  protected addReferenceSync(refSchema: Schema): void {
    this.references.push(refSchema);
  }

  /**
   * @alpha Used for schema editing.
   */
  protected setContext(context: SchemaContext): void {
    this._context = context;
  }

  /**
   * Sets the version of the SchemaKey identifying the schema.
   * @param readVersion The read version of the schema. If undefined, the value from the existing SchemaKey will be used.
   * @param writeVersion The write version of the schema. If undefined, the value from the existing SchemaKey will be used.
   * @param minorVersion The minor version of the schema. If undefined, the value from the existing SchemaKey will be used.
   */
  public setVersion(readVersion?: number, writeVersion?: number, minorVersion?: number): void {
    if (!this._schemaKey)
      throw new ECObjectsError(ECObjectsStatus.InvalidSchemaKey, `The schema '${this.name}' has an invalid SchemaKey.`);

    const newVersion = new ECVersion(readVersion ?? this._schemaKey.readVersion, writeVersion ?? this._schemaKey.writeVersion, minorVersion ?? this._schemaKey.minorVersion);
    this._schemaKey = new SchemaKey(this._schemaKey.name, newVersion);
  }

  /**
   * Gets an item from within this schema. To get by full name use lookupItem instead.
   * @param key the local (unqualified) name, lookup is case-insensitive
   */
  public async getItem<T extends SchemaItem>(name: string): Promise<T | undefined> {
    // this method exists so we can rewire it later when we load partial schemas, for now it is identical to the sync version
    return this.getItemSync<T>(name);
  }

  /**
   * Gets an item from within this schema. To get by full name use lookupItem instead.
   * @param key the local (unqualified) name, lookup is case-insensitive
   */
  public getItemSync<T extends SchemaItem>(name: string): T | undefined {
    // Case-insensitive search
    return this._items.get(name.toUpperCase()) as T;
  }

  /**
   * Attempts to find a schema item within this schema or a (directly) referenced schema
   * @param key The full name or a SchemaItemKey identifying the desired item.
   */
  public async lookupItem<T extends SchemaItem>(key: Readonly<SchemaItemKey> | string): Promise<T | undefined> {
    let schemaName, itemName: string;
    if (typeof (key) === "string") {
      [schemaName, itemName] = SchemaItem.parseFullName(key);
    } else {
      itemName = key.name;
      schemaName = key.schemaName;
    }

    if (!schemaName || schemaName.toUpperCase() === this.name.toUpperCase()) {
      return this.getItem<T>(itemName);
    }

    const refSchema = await this.getReference(schemaName);
    if (!refSchema)
      return undefined;

    return refSchema.getItem<T>(itemName);
  }

  /**
   * Attempts to find a schema item within this schema or a (directly) referenced schema
   * @param key The full name or a SchemaItemKey identifying the desired item.
   */
  public lookupItemSync<T extends SchemaItem>(key: Readonly<SchemaItemKey> | string): T | undefined {
    let schemaName, itemName: string;
    if (typeof (key) === "string") {
      [schemaName, itemName] = SchemaItem.parseFullName(key);
    } else {
      itemName = key.name;
      schemaName = key.schemaName;
    }

    if (!schemaName || schemaName.toUpperCase() === this.name.toUpperCase()) {
      return this.getItemSync<T>(itemName);
    }

    const refSchema = this.getReferenceSync(schemaName);
    if (!refSchema)
      return undefined;

    return refSchema.getItemSync<T>(itemName);
  }

  public getItems<T extends AnySchemaItem>(): IterableIterator<T> {
    if (!this._items)
      return new Map<string, SchemaItem>().values() as IterableIterator<T>;

    return this._items.values() as IterableIterator<T>;
  }

  public *getClasses(): IterableIterator<ECClass> {
    for (const [, value] of this._items) {
      if (ECClass.isECClass(value))
        yield value;
    }
  }

  public async getReference<T extends Schema>(refSchemaName: string): Promise<T | undefined> {
    if (this.references.length === 0)
      return undefined;

    return this.references.find((ref) => ref.name.toLowerCase() === refSchemaName.toLowerCase()) as T;
  }

  public getReferenceNameByAlias(alias: string): string | undefined {
    if (this.references.length === 0)
      return undefined;

    const schema = this.references.find((ref) => ref.alias ? ref.alias.toLowerCase() === alias.toLowerCase() : false);
    return schema ? schema.name : undefined;
  }

  public getReferenceSync<T extends Schema>(refSchemaName: string): T | undefined {
    if (this.references.length === 0)
      return undefined;

    return this.references.find((ref) => ref.name.toLowerCase() === refSchemaName.toLowerCase()) as T;
  }

  /**
   * Save this Schema's properties to an object for serializing to JSON.
   */
  public toJSON(): SchemaProps {
    const schemaJson: { [value: string]: any } = {};
    schemaJson.$schema = SCHEMAURL3_2_JSON; // $schema is required
    schemaJson.name = this.name; // name is required
    schemaJson.version = this.schemaKey.version.toString(true);
    schemaJson.alias = this.alias; // alias is required
    if (undefined !== this.label) // label is optional
      schemaJson.label = this.label;
    if (undefined !== this.description) // description is optional
      schemaJson.description = this.description;
    if (undefined !== this.references && this.references.length > 0) // references is optional
      schemaJson.references = this.references.map(({ name, schemaKey }) => ({ name, version: schemaKey.version.toString() }));

    const customAttributes = serializeCustomAttributes(this.customAttributes);
    if (undefined !== customAttributes)
      schemaJson.customAttributes = customAttributes;
    if (this._items.size > 0) {
      schemaJson.items = {};
      this._items.forEach((schemaItem: SchemaItem) => {
        schemaJson.items[schemaItem.name] = schemaItem.toJSON(false, true);
      });
    }
    return schemaJson as SchemaProps;
  }

  /**
   * Converts the schema to a DOM XML Document.
   * @param schemaXml An empty DOM document to which the schema will be written
   */
  public async toXml(schemaXml: Document): Promise<Document> {
    const schemaMetadata = schemaXml.createElement("ECSchema");
    schemaMetadata.setAttribute("xmlns", SCHEMAURL3_2_XML);
    schemaMetadata.setAttribute("version", this.schemaKey.version.toString());
    schemaMetadata.setAttribute("schemaName", this.name);
    schemaMetadata.setAttribute("alias", this.alias ? this.alias : "");
    if (undefined !== this.label)
      schemaMetadata.setAttribute("displayLabel", this.label);
    if (undefined !== this.description)
      schemaMetadata.setAttribute("description", this.description);

    // Map used for CA serialization
    const refSchemaMap = new Map<string, string>();

    this.references.forEach(({ name, schemaKey, alias }) => {
      const schemaRef = schemaXml.createElement("ECSchemaReference");
      schemaRef.setAttribute("name", name);
      schemaRef.setAttribute("version", schemaKey.version.toString());
      schemaRef.setAttribute("alias", alias ? alias : "");
      schemaMetadata.appendChild(schemaRef);
      refSchemaMap.set(name, schemaKey.version.toString());
    });

    if (this._customAttributes) {
      const parentElem = schemaXml.createElement("ECCustomAttributes");
      for (const [name, attribute] of this._customAttributes) {
        const caElem = await XmlSerializationUtils.writeCustomAttribute(name, attribute, schemaXml, this);
        parentElem.appendChild(caElem);
      }
      schemaMetadata.appendChild(parentElem);
    }

    for (const [, item] of this._items) {
      const itemXml = await item.toXml(schemaXml);
      schemaMetadata.appendChild(itemXml);
    }

    schemaXml.appendChild(schemaMetadata);
    return schemaXml;
  }

  /**
   * Loads the schema header (name, version alias, label and description) from the input SchemaProps
   */
  public fromJSONSync(schemaProps: SchemaProps) {
    if (undefined === this._schemaKey) {
      const schemaName = schemaProps.name;
      const version = ECVersion.fromString(schemaProps.version);
      this._schemaKey = new SchemaKey(schemaName, version);
    } else {
      if (schemaProps.name.toLowerCase() !== this.name.toLowerCase())
        throw new ECObjectsError(ECObjectsStatus.InvalidECJson, `The Schema ${this.name} does not match the provided name, '${schemaProps.name}'.`);
      if (this.schemaKey.version.compare(ECVersion.fromString(schemaProps.version)))
        throw new ECObjectsError(ECObjectsStatus.InvalidECJson, `The Schema ${this.name} has the version '${this.schemaKey.version}' that does not match the provided version '${schemaProps.version}'.`);
    }

    if (SCHEMAURL3_2_JSON !== schemaProps.$schema && SCHEMAURL3_2_XML !== schemaProps.$schema) // TODO: Allow for 3.x URI versions to allow the API to read newer specs. (Start at 3.2 though)
      throw new ECObjectsError(ECObjectsStatus.MissingSchemaUrl, `The Schema ${this.name} has an unsupported namespace '${schemaProps.$schema}'.`);

    if (ECName.validate(schemaProps.alias)) {
      this._alias = schemaProps.alias;
    } else {
      throw new ECObjectsError(ECObjectsStatus.InvalidECJson, `The Schema ${schemaProps.name} does not have the required 'alias' attribute.`);
    }

    if (undefined !== schemaProps.label)
      this._label = schemaProps.label;

    if (undefined !== schemaProps.description)
      this._description = schemaProps.description;
  }

  /**
   * Loads the schema header (name, version alias, label and description) from the input SchemaProps
   */
  public async fromJSON(schemaProps: SchemaProps) {
    this.fromJSONSync(schemaProps);
  }

  /**
   * Completely loads the SchemaInfo from the input json and starts loading the entire schema.  The complete schema can be retrieved from the
   * schema context using the getCachedSchema method
   */
  public static async startLoadingFromJson(jsonObj: object | string, context: SchemaContext): Promise<SchemaInfo> {
    const schema = new Schema(context);

    const reader = new SchemaReadHelper(JsonParser, context);
    const rawSchema = typeof jsonObj === "string" ? JSON.parse(jsonObj) : jsonObj;
    return reader.readSchemaInfo(schema, rawSchema);
  }

  public static async fromJson(jsonObj: object | string, context: SchemaContext): Promise<Schema> {
    let schema: Schema = new Schema(context);

    const reader = new SchemaReadHelper(JsonParser, context);
    const rawSchema = typeof jsonObj === "string" ? JSON.parse(jsonObj) : jsonObj;
    schema = await reader.readSchema(schema, rawSchema);

    return schema;
  }

  /**
   * Completely loads the Schema from the input json. The schema is cached in the schema context.
   */
  public static fromJsonSync(jsonObj: object | string, context: SchemaContext): Schema {
    let schema: Schema = new Schema(context);

    const reader = new SchemaReadHelper(JsonParser, context);
    const rawSchema = typeof jsonObj === "string" ? JSON.parse(jsonObj) : jsonObj;
    schema = reader.readSchemaSync(schema, rawSchema);

    return schema;
  }

  /**
   * @internal
   */
  public static isSchema(object: any): object is Schema {
    const schema = object as Schema;

    return schema !== undefined && schema.schemaKey !== undefined && schema.context !== undefined;
  }

  /**
   * @alpha
   * Used for schema editing.
   */
  protected setDisplayLabel(displayLabel: string) {
    this._label = displayLabel;
  }

  /**
   * @alpha
   * Used for schema editing.
   */
  protected setDescription(description: string) {
    this._description = description;
  }
}

/**
 * Hackish approach that works like a "friend class" so we can access protected members without making them public.
 * We cannot put this into Helper.ts and make it non-export, because we are importing Helper.ts from this file, and the circular import
 * would prevent this class from extending Schema.
 * @internal
 */
export abstract class MutableSchema extends Schema {
  public abstract override addCustomAttribute(customAttribute: CustomAttribute): void;
  public abstract override createEntityClass(name: string, modifier?: ECClassModifier): Promise<EntityClass>;
  public abstract override createEntityClassSync(name: string, modifier?: ECClassModifier): EntityClass;
  public abstract override createMixinClass(name: string): Promise<Mixin>;
  public abstract override createMixinClassSync(name: string): Mixin;
  public abstract override createStructClass(name: string, modifier?: ECClassModifier): Promise<StructClass>;
  public abstract override createStructClassSync(name: string, modifier?: ECClassModifier): StructClass;
  public abstract override createCustomAttributeClass(name: string, modifier?: ECClassModifier): Promise<CustomAttributeClass>;
  public abstract override createCustomAttributeClassSync(name: string, modifier?: ECClassModifier): CustomAttributeClass;
  public abstract override createRelationshipClass(name: string, modifier?: ECClassModifier): Promise<RelationshipClass>;
  public abstract override createRelationshipClassSync(name: string, modifier?: ECClassModifier): RelationshipClass;
  public abstract override createEnumeration(name: string, primitiveType?: PrimitiveType.Integer | PrimitiveType.String): Promise<Enumeration>;
  public abstract override createEnumerationSync(name: string, primitiveType?: PrimitiveType.Integer | PrimitiveType.String): Enumeration;
  public abstract override createKindOfQuantity(name: string): Promise<KindOfQuantity>;
  public abstract override createKindOfQuantitySync(name: string): KindOfQuantity;
  public abstract override createUnit(name: string): Promise<Unit>;
  public abstract override createUnitSync(name: string): Unit;
  public abstract override createConstant(name: string): Promise<Constant>;
  public abstract override createConstantSync(name: string): Constant;
  public abstract override createInvertedUnit(name: string): Promise<InvertedUnit>;
  public abstract override createInvertedUnitSync(name: string): InvertedUnit;
  public abstract override createPhenomenon(name: string): Promise<Phenomenon>;
  public abstract override createPhenomenonSync(name: string): Phenomenon;
  public abstract override createFormat(name: string): Promise<Format>;
  public abstract override createFormatSync(name: string): Format;
  public abstract override createUnitSystem(name: string): Promise<UnitSystem>;
  public abstract override createUnitSystemSync(name: string): UnitSystem;
  public abstract override createPropertyCategory(name: string): Promise<PropertyCategory>;
  public abstract override createPropertyCategorySync(name: string): PropertyCategory;
  public abstract override addItem<T extends SchemaItem>(item: T): void;
  public abstract override addReference(refSchema: Schema): Promise<void>;
  public abstract override addReferenceSync(refSchema: Schema): void;
  public abstract override setContext(schemaContext: SchemaContext): void;
  public abstract override deleteClass(name: string): Promise<void>;
  public abstract override deleteClassSync(name: string): void;
  public abstract override deleteSchemaItem(name: string): Promise<void>;
  public abstract override deleteSchemaItemSync(name: string): void;
}
