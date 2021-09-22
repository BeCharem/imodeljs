/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import * as React from "react";
import {
  BackstageAppButton, ConfigurableUiManager, ContentGroup, ContentGroupProps, ContentGroupProvider, ContentProps, FrontstageProps,
  IModelViewportControl, StandardContentToolsProvider, StandardFrontstageProps, StandardFrontstageProvider,
  StandardNavigationToolsProvider,
  StandardStatusbarItemsProvider,
  SyncUiEventArgs, SyncUiEventDispatcher,
  UiFramework,
} from "@bentley/ui-framework";
import { StageUsage, StandardContentLayouts } from "@bentley/ui-abstract";
import { ScreenViewport } from "@bentley/imodeljs-frontend";
import { SampleAppIModelApp, SampleAppUiActionId } from "../..";
import { AppUi2StageItemsProvider } from "../../tools/AppUi2StageItemsProvider";
import { getSavedViewLayoutProps } from "../../tools/UiProviderTool";

export class FrontstageUi2ContentGroupProvider extends ContentGroupProvider {
  /* eslint-disable react/jsx-key */
  public static supplyViewOverlay = (viewport: ScreenViewport) => {
    if (viewport.view) {
      return <MyCustomViewOverlay />;
    }
    return null;
  };

  public override prepareToSaveProps(contentGroupProps: ContentGroupProps) {
    const newContentsArray = contentGroupProps.contents.map((content: ContentProps) => {
      const newContent = { ...content };
      if (newContent.applicationData)
        delete newContent.applicationData;
      return newContent;
    });
    return { ...contentGroupProps, contents: newContentsArray };
  }

  public override applyUpdatesToSavedProps(contentGroupProps: ContentGroupProps) {
    const newContentsArray = contentGroupProps.contents.map((content: ContentProps, index) => {
      const newContent = { ...content };

      if (newContent.classId === IModelViewportControl.id) {
        newContent.applicationData = {
          ...newContent.applicationData,
          supplyViewOverlay: index === 0 ? FrontstageUi2ContentGroupProvider.supplyViewOverlay : undefined,
          supports: ["issueResolutionMarkers", "viewIdSelection", "3dModels", "2dModels"],
          isPrimaryView: true,
        };
      }
      return newContent;
    });
    return { ...contentGroupProps, contents: newContentsArray };
  }

  public async provideContentGroup(props: FrontstageProps): Promise<ContentGroup> {
    const savedViewLayoutProps = await getSavedViewLayoutProps(props.id, UiFramework.getIModelConnection());
    if (savedViewLayoutProps) {
      const viewState = savedViewLayoutProps.contentGroupProps.contents[0].applicationData?.viewState;
      if (viewState) {
        UiFramework.setDefaultViewState(viewState);
      }
      const contentGroupProps = this.applyUpdatesToSavedProps(savedViewLayoutProps.contentGroupProps);
      return new ContentGroup(contentGroupProps);
    }

    return new ContentGroup({
      id: "main-content-group",
      layout: StandardContentLayouts.singleView,
      contents: [
        {
          id: "primaryContent",
          classId: IModelViewportControl.id,
          applicationData: {
            supplyViewOverlay: FrontstageUi2ContentGroupProvider.supplyViewOverlay,
            isPrimaryView: true,
            supports: ["issueResolutionMarkers", "viewIdSelection", "3dModels", "2dModels"],
            viewState: UiFramework.getDefaultViewState,
            iModelConnection: UiFramework.getIModelConnection,
          },
        },
      ],
    });
  }
}

export class FrontstageUi2 {
  private static _contentGroupProvider = new FrontstageUi2ContentGroupProvider();
  private static showCornerButtons = true;

  public static supplyAppData(_id: string, _applicationData?: any) {
    return {
      viewState: UiFramework.getDefaultViewState,
      iModelConnection: UiFramework.getIModelConnection,
    };
  }

  public static register() {
    const cornerButton = FrontstageUi2.showCornerButtons ? <BackstageAppButton key="ui2-backstage" icon={"icon-bentley-systems"} /> : undefined;
    const hideNavigationAid = !FrontstageUi2.showCornerButtons;
    const setUpCustomToolGroups = true;
    const applicationData = setUpCustomToolGroups ? {
      defaultContentTools: {
        vertical: {
          selectElementGroupPriority: 100,
          measureGroupPriority: 200,
          selectionGroupPriority: 300,
        },
        horizontal: {
          clearSelectionGroupPriority: 100,
          overridesGroupPriority: 200,
        },
      },
    } : undefined;

    const ui2StageProps: StandardFrontstageProps = {
      id: "Ui2",
      version: 1.1,
      contentGroupProps: FrontstageUi2._contentGroupProvider,
      hideNavigationAid,
      cornerButton,
      usage: StageUsage.General,
      applicationData,
    };

    ConfigurableUiManager.addFrontstageProvider(new StandardFrontstageProvider(ui2StageProps));
    this.registerToolProviders();
  }

  private static registerToolProviders() {

    // Provides standard tools for ToolWidget in ui2.0 stage
    StandardContentToolsProvider.register({
      horizontal: {
        clearSelection: true,
        clearDisplayOverrides: true,
        hide: "group",
        isolate: "group",
        emphasize: "element",
      },
    }, (stageId: string, _stageUsage: string, _applicationData: any) => {
      return stageId === "Ui2";
    });

    // Provides standard tools for NavigationWidget in ui2.0 stage
    StandardNavigationToolsProvider.register(undefined, (stageId: string, _stageUsage: string, _applicationData: any) => {
      return stageId === "Ui2";
    });

    // Provides standard status fields for ui2.0 stage
    StandardStatusbarItemsProvider.register(undefined, (stageId: string, _stageUsage: string, _applicationData: any) => {
      return stageId === "Ui2";
    });

    // Provides example widgets ui2.0 stage
    AppUi2StageItemsProvider.register(FrontstageUi2.showCornerButtons);
  }
}

export function MyCustomViewOverlay() {
  const [syncIdsOfInterest] = React.useState([SampleAppUiActionId.setTestProperty]);
  const [showOverlay, setShowOverlay] = React.useState(SampleAppIModelApp.getTestProperty() !== "HIDE");

  React.useEffect(() => {
    const handleSyncUiEvent = (args: SyncUiEventArgs) => {
      if (0 === syncIdsOfInterest.length)
        return;

      // istanbul ignore else
      if (syncIdsOfInterest.some((value: string): boolean => args.eventIds.has(value))) {
        const show = SampleAppIModelApp.getTestProperty() !== "HIDE";
        if (show !== showOverlay)
          setShowOverlay(show);
      }
    };

    // Note: that items with conditions have condition run when loaded into the items manager
    SyncUiEventDispatcher.onSyncUiEvent.addListener(handleSyncUiEvent);
    return () => {
      SyncUiEventDispatcher.onSyncUiEvent.removeListener(handleSyncUiEvent);
    };
  }, [setShowOverlay, showOverlay, syncIdsOfInterest]);

  return showOverlay ?
    <div className="uifw-view-overlay">
      <div className="my-custom-control" style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        height: "100%",
        backgroundColor: "rgba(0, 0, 0, 0.5)",
      }}>
        <div>Hello World</div>
        <div>(turn off using Hide/Show items tool in horizontal toolbar at top-left)</div>
      </div>
    </div> : null;
}
