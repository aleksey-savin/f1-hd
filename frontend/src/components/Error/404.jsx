import useDocTitle from '../../hooks/use-doc-title';

import Transitions from '../../animations/Transition';
import '../../css/error.css';

import { NavLink } from 'react-router';

import Button from 'react-bootstrap/Button';

const NotFound = () => {
  useDocTitle('F1 HD | СТРАНИЦА НЕ НАЙДЕНА');

  return (
    <Transitions>
      <div id='error'>
        <div className='error'>
          <div className='error-code'>
            <h1>
              4<span></span>4
            </h1>
          </div>
          <h2>Упс! Мы ничего не нашли</h2>
          <p>К сожалению, запрашиваемой страницы не существует.</p>
          <Button as={NavLink} to='/' variant='primary' size='lg'>
            НА ГЛАВНУЮ
          </Button>
        </div>
      </div>
    </Transitions>
  );
};

export default NotFound;
