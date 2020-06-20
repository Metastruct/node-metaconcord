import { Container, IService } from "../container";

export class TestService implements IService {
	public name;
}

export default (container: Container): IService => {
	return new TestService();
};
