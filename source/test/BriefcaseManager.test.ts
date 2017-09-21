/*---------------------------------------------------------------------------------------------
|  $Copyright: (c) 2017 Bentley Systems, Incorporated. All rights reserved. $
 *--------------------------------------------------------------------------------------------*/
import { IModel } from "../IModel";
import { BisCore } from "../BisCore";
import { OpenMode } from "@bentley/bentleyjs-core/lib/BeSQLite";
import { AuthorizationToken, AccessToken, ImsActiveSecureTokenClient, ImsDelegationSecureTokenClient } from "@bentley/imodeljs-clients";
import { ConnectClient, Project, ChangeSet } from "@bentley/imodeljs-clients";
import { IModelHubClient } from "@bentley/imodeljs-clients";
import { IModelTestUtils } from "./IModelTestUtils";
import { expect, assert } from "chai";
import * as fs from "fs";
import * as path from "path";

declare const __dirname: string;

describe("BriefcaseManager", () => {
  const projectName = "NodeJsTestProject";
  const iModelName = "MyTestModel";
  let accessToken: AccessToken;
  let iModelId: string;
  const hubClient = new IModelHubClient("QA");
  let changeSets: ChangeSet[];
  let iModelLocalPath: string;

  before(async () => {
    // First, register any schemas that will be used in the tests.
    BisCore.registerSchema();

    const authToken: AuthorizationToken|undefined = await (new ImsActiveSecureTokenClient("QA")).getToken(IModelTestUtils.user.email, IModelTestUtils.user.password);
    expect(authToken);

    const token = await (new ImsDelegationSecureTokenClient("QA")).getToken(authToken!);
    expect(token);
    accessToken = token!;

    const project: Project | undefined = await (new ConnectClient("QA")).getProject(accessToken, {
      $select: "*",
      $filter: "Name+eq+'" + projectName + "'",
    });
    expect(project);
    expect(project.wsgId);

    const iModels = await hubClient.getIModels(accessToken, project.wsgId, {
      $select: "*",
      $filter: "Name+eq+'" + iModelName + "'",
    });
    expect(iModels.length > 0);

    iModelId = iModels[0].wsgId;
    expect(!!iModelId);

    changeSets = await hubClient.getChangeSets(accessToken, iModelId, false);
    expect(changeSets.length).greaterThan(2);

    iModelLocalPath = path.join(__dirname, "../assets/imodels/", iModelId);
    // deleteAllBriefcases();
  });

  // const deleteAllBriefcases = async () => {
  //   const promises = new Array<Promise<void>>();
  //   const briefcases = await hubClient.getBriefcases(accessToken, iModelId);
  //   briefcases.forEach((briefcase: Briefcase) => {
  //     promises.push(hubClient.deleteBriefcase(accessToken, iModelId, briefcase.briefcaseId));
  //   });
  //   await Promise.all(promises);
  // };

  it("should be able to open an IModel from the Hub", async () => {
    const iModel: IModel = await IModel.open(accessToken, iModelId);
    assert.exists(iModel);

    expect(fs.existsSync(iModelLocalPath));
    const files = fs.readdirSync(iModelLocalPath);
    expect(files.length).greaterThan(0);

    await iModel.close(accessToken);
  });

  it("should reuse closed briefcases in ReadWrite mode", async () => {
    const files = fs.readdirSync(iModelLocalPath);

    const iModel: IModel = await IModel.open(accessToken, iModelId);
    assert.exists(iModel);
    await iModel.close(accessToken);

    const files2 = fs.readdirSync(iModelLocalPath);
    expect(files2.length).equals(files.length);
    const diff = files2.filter((item) => files.indexOf(item) < 0);
    expect(diff.length).equals(0);
  });

  it("should reuse open briefcases in Readonly mode", async () => {
    const briefcases = fs.readdirSync(iModelLocalPath);
    expect(briefcases.length).greaterThan(0);

    const iModels = new Array<IModel>();
    for (let ii = 0; ii < 5; ii++) {
      const iModel: IModel = await IModel.open(accessToken, iModelId, OpenMode.Readonly);
      assert.exists(iModel);
      iModels.push(iModel);
    }

    const briefcases2 = fs.readdirSync(iModelLocalPath);
    expect(briefcases2.length).equals(briefcases.length);
    const diff = briefcases2.filter((item) => briefcases.indexOf(item) < 0);
    expect(diff.length).equals(0);
  });

  // should not reuse open briefcases in ReadWrite mode
  // should not reuse open briefcases for different versions in Readonly mode
  // should reuse closed briefcases for newer versions
  // should not reuse closed briefcases for older versions
  // should delete closed briefcases if necessary
  // should reuse briefcases between users in readonly mode
  // should not reuse briefcases between users in readwrite mode
});
