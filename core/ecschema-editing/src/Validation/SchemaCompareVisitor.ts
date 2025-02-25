/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
/** @packageDocumentation
 * @module Comparison
 */

import { AnyClass, AnyProperty, Constant, CustomAttributeClass, CustomAttributeContainerProps,
  ECClass, EntityClass, Enumeration, Format, InvertedUnit, ISchemaPartVisitor, KindOfQuantity, Mixin,
  Phenomenon, Property, PropertyCategory, RelationshipClass, RelationshipConstraint, Schema, SchemaItem,
  SchemaItemType, StructClass, Unit, UnitSystem,
} from "@itwin/ecschema-metadata";
import { ISchemaComparer } from "./SchemaComparer";

/**
 * An ISchemaPartVisitor interface implementation that is used to compare to Schemas.
 * @internal
 */
export class SchemaCompareVisitor implements ISchemaPartVisitor {
  private _schemaB: Schema;
  private _schemaComparer: ISchemaComparer;

  /**
   * Initializes a new SchemaCompareVisitor instance.
   * @param schemaComparer The [[SchemaComparer]] to use to compare each item of the schema.
   * @param schemaToCompare The second or 'B' schema to compare against the schema being traversed (Schema A).
   */
  constructor(schemaComparer: ISchemaComparer, schemaToCompare: Schema) {
    this._schemaComparer = schemaComparer;
    this._schemaB = schemaToCompare;
  }

  /**
   * Called before schema traversal.
   * @param schema a Schema object.
   */
  public async visitFullSchema(schemaA: Schema) {
    this._schemaComparer.compareSchemaProps(schemaA, this._schemaB);
  }

  /**
   * Called for each [[SchemaItem]] instance found during schema traversal.
   * @param schemaItem a SchemaItem object.
   */
  public async visitSchemaItem(schemaItemA: SchemaItem) {
    const schemaItemB = await this._schemaB.lookupItem(schemaItemA.name);
    this._schemaComparer.compareSchemaItems(schemaItemA, schemaItemB);
  }

  /**
   * Called for each [[AnyClass]] instance found during schema traversal.
   * @param ecClass an ECClass object.
   */
  public async visitClass(classA: AnyClass): Promise<void> {
    const classB = await this._schemaB.lookupItem<AnyClass>(classA.name);
    this._schemaComparer.compareClasses(classA, classB);
  }

  /**
   * Called for each [[AnyProperty]] instance of an ECClass.
   * @param property an AnyProperty object.
   */
  public async visitProperty(propertyA: AnyProperty): Promise<void> {
    let propertyB: AnyProperty | undefined;

    const classB = await this._schemaB.lookupItem<ECClass>(propertyA.class.name);
    if (classB && ECClass.isECClass(classB)) {
      propertyB = await classB.getProperty(propertyA.name) as AnyProperty;
      this._schemaComparer.compareProperties(propertyA, propertyB);
    }
  }

  /**
   * Called for each [[EntityClass]] instance found during schema traversal.
   * @param entityClass an EntityClass object.
   */
  public async visitEntityClass(entityA: EntityClass): Promise<void> {
    const entityB = await this._schemaB.lookupItem<EntityClass>(entityA.name);
    this._schemaComparer.compareEntityClasses(entityA, entityB);
  }

  /**
   * Called for each [[StructClass]] instance found during schema traversal.
   * @param structClass a StructClass object.
   */
  public async visitStructClass(_structA: StructClass): Promise<void> {
    // No comparison to make specifically on StructClasses
  }

  /**
   * Called for each [[Mixin]] instance found during schema traversal.
   * @param mixin a Mixin object.
   */
  public async visitMixin(mixinA: Mixin): Promise<void> {
    const mixinB = await this._schemaB.lookupItem<Mixin>(mixinA.name);
    if (!mixinB || mixinB.schemaItemType === SchemaItemType.Mixin)
      this._schemaComparer.compareMixins(mixinA, mixinB);
  }

  /**
   * Called for each [[RelationshipClass]] instance found during schema traversal.
   * @param relationshipClass a RelationshipClass object.
   */
  public async visitRelationshipClass(relationshipA: RelationshipClass): Promise<void> {
    const relationshipB = await this._schemaB.lookupItem<RelationshipClass>(relationshipA.name);
    if (!relationshipB || relationshipB.schemaItemType === SchemaItemType.RelationshipClass)
      this._schemaComparer.compareRelationshipClasses(relationshipA, relationshipB);
  }

  /**
   * Called for each [[RelationshipConstraint]] of each RelationshipClass found during schema traversal.
   * @param relationshipConstraint a RelationshipConstraint object.
   */
  public async visitRelationshipConstraint(constraintA: RelationshipConstraint): Promise<void> {
    let constraintB: RelationshipConstraint | undefined;
    const relationshipB = await this._schemaB.lookupItem<RelationshipClass>(constraintA.relationshipClass.name);
    if (relationshipB && relationshipB.schemaItemType === SchemaItemType.RelationshipClass)
      constraintB = constraintA.isSource ? relationshipB.source : relationshipB.target;
    this._schemaComparer.compareRelationshipConstraints(constraintA, constraintB);
  }

  /**
   * Called for each [[CustomAttributeClass]] instance found during schema traversal.
   * @param customAttributeClass a CustomAttributeClass object.
   */
  public async visitCustomAttributeClass(customAttributeA: CustomAttributeClass): Promise<void> {
    const customAttributeB = await this._schemaB.lookupItem<CustomAttributeClass>(customAttributeA.name);
    if (!customAttributeB || customAttributeB.schemaItemType === SchemaItemType.CustomAttributeClass)
      this._schemaComparer.compareCustomAttributeClasses(customAttributeA, customAttributeB);
  }

  /**
   * Called for each [[CustomAttribute]] container in the schema.
   * @param customAttributeContainer a [[CustomAttributeContainerProps]] object.
   */
  public async visitCustomAttributeContainer(containerA: CustomAttributeContainerProps): Promise<void> {
    const nameParts = containerA.fullName.split(".");
    const shortName = nameParts.length === 1 ? nameParts[0] : nameParts[1];
    let containerB: CustomAttributeContainerProps | undefined;

    if (Schema.isSchema(containerA)) {
      containerB = this._schemaB;
    } else if (ECClass.isECClass(containerA)) {
      containerB = await this._schemaB.lookupItem(containerA.name);
    } else if (Property.isProperty(containerA)) {
      const parent = await this._schemaB.lookupItem<ECClass>(containerA.class.name);
      containerB = parent && ECClass.isECClass(parent) ? await parent.getProperty(shortName) : undefined;
    } else if (RelationshipConstraint.isRelationshipConstraint(containerA)) {
      const parent = await this._schemaB.lookupItem<RelationshipClass>(containerA.relationshipClass.name);
      containerB = parent ? containerA.isSource ? parent.source : parent.target : undefined;
    }

    this._schemaComparer.compareCustomAttributeContainers(containerA, containerB);
  }

  /**
   * Called for each [[Enumeration]] instance found during schema traversal.
   * @param enumeration an Enumeration object.
   */
  public async visitEnumeration(enumA: Enumeration) {
    const enumB = await this._schemaB.lookupItem<Enumeration>(enumA.name);
    if (!enumB || enumB.schemaItemType === SchemaItemType.Enumeration)
      this._schemaComparer.compareEnumerations(enumA, enumB);
  }

  /**
   * Called for each [[KindOfQuantity]] instance found during schema traversal.
   * @param koq a KindOfQuantity object.
   */
  public async visitKindOfQuantity(koqA: KindOfQuantity) {
    const koqB = await this._schemaB.lookupItem<KindOfQuantity>(koqA.name);
    if (!koqB || koqB.schemaItemType === SchemaItemType.KindOfQuantity)
      this._schemaComparer.compareKindOfQuantities(koqA, koqB);
  }

  /**
   * Called for each [[PropertyCategory]] instance found during schema traversal.
   * @param category a PropertyCategory object.
   */
  public async visitPropertyCategory(categoryA: PropertyCategory) {
    const categoryB = await this._schemaB.lookupItem<PropertyCategory>(categoryA.name);
    if (!categoryB || categoryB.schemaItemType === SchemaItemType.PropertyCategory)
      this._schemaComparer.comparePropertyCategories(categoryA, categoryB);
  }

  /**
   * Called for each [[Format]] instance found during schema traversal.
   * @param format a Format object.
   */
  public async visitFormat(formatA: Format): Promise<void> {
    const formatB = await this._schemaB.lookupItem<Format>(formatA.name);
    if (!formatB || formatB.schemaItemType === SchemaItemType.Format)
      this._schemaComparer.compareFormats(formatA, formatB);
  }

  /**
   * Called for each [[Unit]] instance found during schema traversal.
   * @param unit a Unit object.
   */
  public async visitUnit(unitA: Unit): Promise<void> {
    const unitB = await this._schemaB.lookupItem<Unit>(unitA.name);
    if (!unitB || Unit.isUnit(unitB))
      this._schemaComparer.compareUnits(unitA, unitB);
  }

  /**
   * Called for each [[InvertedUnit]] instance found during schema traversal.
   * @param invertedUnit an InvertedUnit object.
   */
  public async visitInvertedUnit(invertedUnitA: InvertedUnit): Promise<void> {
    const invertedUnitB = await this._schemaB.lookupItem<InvertedUnit>(invertedUnitA.name);
    if (!invertedUnitB || invertedUnitB.schemaItemType === SchemaItemType.InvertedUnit)
      this._schemaComparer.compareInvertedUnits(invertedUnitA, invertedUnitB);
  }

  /**
   * Called for each [[UnitSystem]] instance found during schema traversal.
   * @param unitSystem a UnitSystem object.
   */
  public async visitUnitSystem(_unitSystemA: UnitSystem): Promise<void> {
    // No comparison to make specifically on unitSystem
  }

  /**
   * Called for each [[Phenomenon]] instance found during schema traversal.
   * @param phenomena a Phenomenon object.
   */
  public async visitPhenomenon(phenomenonA: Phenomenon): Promise<void> {
    const phenomenonB = await this._schemaB.lookupItem<Phenomenon>(phenomenonA.name);
    if (!phenomenonB || phenomenonB.schemaItemType === SchemaItemType.Phenomenon)
      this._schemaComparer.comparePhenomenons(phenomenonA, phenomenonB);
  }

  /**
   * Called for each [[Constant]] instance found during schema traversal.
   * @param constant a Constant object.
   */
  public async visitConstant(constantA: Constant): Promise<void> {
    const constantB = await this._schemaB.lookupItem<Constant>(constantA.name);
    if (!constantB || constantB.schemaItemType === SchemaItemType.Constant)
      this._schemaComparer.compareConstants(constantA, constantB);
  }
}
