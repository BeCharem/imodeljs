/*---------------------------------------------------------------------------------------------
* Copyright (c) 2019 Bentley Systems, Incorporated. All rights reserved.
* Licensed under the MIT License. See LICENSE.md in the project root for license terms.
*--------------------------------------------------------------------------------------------*/
import { mount, shallow } from "enzyme";
import * as React from "react";
import { InputLabel, InputStatus } from "../../ui-core";

describe("<InputLabel />", () => {
  it("should render", () => {
    mount(<InputLabel label="input test" />);
  });

  it("renders correctly", () => {
    shallow(<InputLabel label="input test" />).should.matchSnapshot();
  });

  it("renders disabled correctly", () => {
    shallow(<InputLabel label="input test" disabled={true} />).should.matchSnapshot();
  });

  it("renders status correctly", () => {
    shallow(<InputLabel label="input test" status={InputStatus.Success} />).should.matchSnapshot();
  });

  it("renders message correctly", () => {
    shallow(<InputLabel label="input test" message="Test message" />).should.matchSnapshot();
  });
});
