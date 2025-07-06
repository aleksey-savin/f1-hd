import useDocTitle from "../../hooks/use-doc-title";

import Transitions from "../../animations/Transition";
import "../../css/error.css";

import { NavLink } from "react-router";

import Button from "react-bootstrap/Button";

const NetworkError = () => {
  useDocTitle("F1 HD | ПРОБЛЕМЫ С СЕТЬЮ");
  return (
    <Transitions>
      <div id="error">
        <div className="error">
          <div className="error-code">
            <h1>
              <span></span>
            </h1>
          </div>
          <h2>Упс! Похоже на проблемы с сетью</h2>
          <p>
            К сожалению, мы не смогли запросить с сервера необходимые данные
            из-за проблем с сетью. Проверьте Ваше интернет-подключение
          </p>
          <Button as={NavLink} to="/" variant="primary" size="lg">
            ПОПРОБОВАТЬ СНОВА
          </Button>
        </div>
      </div>
    </Transitions>
  );
};

export default NetworkError;
